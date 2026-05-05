import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DirectChatTransport } from 'ai';
import type { Fidelity, ListMessagesResponse, PutMessagesRequest } from '@open-design/contracts';
import { api } from '../../lib/api.js';
import { byokKey } from '../../lib/byok-key.js';
import { getModelPref } from '../../lib/model-pref.js';
import { subscribeModelChange } from '../../lib/model-pref-events.js';
import { createAgent } from './agent.js';
import { useTodos } from './todos-state.js';
import type { DesignAgentUIMessage } from './ui-messages.js';
import { spawnVerifier, formatVerdictForMain, type VerifierResult } from './verifier.js';

export interface UseAgentChatOptions {
  projectId: string;
  /**
   * Active chat id（多 chat 支持，Task 2）。messages 按此 chatId 持久化 +
   * filter；切 chat 时通过 useChat `id` 维度强制重建 Chat 实例。
   *
   * 允许 null：launch 时 WorkspaceProvider 还在 hydrate chats，第一次 render 时
   * 还没 active chat。此时 useChat 仍构建（用 placeholder id），但 hydration
   * effect skip，sendMessage 也会被 ChatPanel 阻拦（chat panel 检查
   * activeChatId）。
   */
  chatId: string | null;
  fidelity: Fidelity;
  designSystemId?: string;
  designSystemName?: string;
  designSystemTokensCss?: string;
}

export interface VerifierState {
  /** True between fork_verifier_agent firing and the verdict landing. */
  running: boolean;
  /** The most recent verdict (null until the first verifier completes). */
  lastResult: VerifierResult | null;
  /** Surfaced if the orchestrator throws before producing a synthetic verdict. */
  error: Error | null;
}

export interface UseAgentChatHandle {
  messages: DesignAgentUIMessage[];
  sendMessage: ReturnType<typeof useChat<DesignAgentUIMessage>>['sendMessage'];
  status: ReturnType<typeof useChat<DesignAgentUIMessage>>['status'];
  error: ReturnType<typeof useChat<DesignAgentUIMessage>>['error'];
  regenerate: ReturnType<typeof useChat<DesignAgentUIMessage>>['regenerate'];
  stop: ReturnType<typeof useChat<DesignAgentUIMessage>>['stop'];
  hasKey: boolean;
  /** Call after byokKey.set(...) so the agent rebuilds with the new key. */
  refreshKey: () => void;
  /** Verifier sub-agent state (P2-7). */
  verifier: VerifierState;
}

export function useAgentChat(opts: UseAgentChatOptions): UseAgentChatHandle {
  // Bumped after the user changes their API key; forces Chat re-creation.
  const [keyTick, setKeyTick] = useState(0);
  // Bumped when the user picks a new model in ModelDropdown; forces Chat re-creation.
  const [modelTick, setModelTick] = useState(0);
  useEffect(() => {
    return subscribeModelChange(() => setModelTick((n) => n + 1));
  }, []);

  const { setAll: onTodosUpdate } = useTodos();

  // Latest projectId held in a ref so persistThread (memoized once) can read
  // the current project without re-creating the Chat instance every project switch.
  const projectIdRef = useRef(opts.projectId);
  projectIdRef.current = opts.projectId;
  // Same for chatId — persistThread reads the current chat at fire time.
  const chatIdRef = useRef(opts.chatId);
  chatIdRef.current = opts.chatId;

  const transport = useMemo(() => {
    // Use placeholder when no key is set yet — never actually sent because ChatPanel
    // gates sendMessage on hasKey. We always build a transport so useChat doesn't
    // fall back to its default HTTP transport (which would POST /api/chat → 404).
    const { provider } = getModelPref();
    const apiKey = byokKey.get(provider) ?? 'pending-byok-key';
    const agent = createAgent({
      projectId: opts.projectId,
      apiKey,
      provider,
      fidelity: opts.fidelity,
      designSystemId: opts.designSystemId,
      designSystemName: opts.designSystemName,
      designSystemTokensCss: opts.designSystemTokensCss,
      onTodosUpdate,
    });
    return new DirectChatTransport({ agent });
  }, [
    opts.projectId,
    opts.fidelity,
    opts.designSystemId,
    opts.designSystemName,
    opts.designSystemTokensCss,
    keyTick,
    modelTick,
    onTodosUpdate,
  ]);

  // PUT the whole thread to worker. Two callers (see below) trigger this:
  //   1. wrapped sendMessage() — right after the user message is pushed,
  //      so the user input survives an immediate refresh even if the agent
  //      stream hasn't started yet.
  //   2. onFinish — after each assistant turn (incl. each ToolLoopAgent step)
  //      completes, so the assistant reply and tool calls of this round are
  //      saved.
  //
  // `keepalive: true` lets the request finish even if the user navigates away
  // or refreshes before the fetch resolves. Spec caps body at 64KB; threads
  // with attached screenshots (FileUIPart with data URL) blow past that, so we
  // fall back to a normal fetch for big payloads — accepting the risk that an
  // immediate unload may abort it (rare for these large submissions because
  // the user just clicked Send).
  const KEEPALIVE_MAX_BYTES = 50 * 1024;
  const persistThread = useCallback((messages: DesignAgentUIMessage[]) => {
    const projectId = projectIdRef.current;
    const chatId = chatIdRef.current;
    if (!chatId) {
      // Skip persist when no active chat yet (lazy-create still in flight).
      // The next sendMessage after activeChatId is set will repersist the full
      // thread.
      return;
    }
    const body: PutMessagesRequest = { chatId, messages };
    const serialized = JSON.stringify(body);
    const useKeepalive = serialized.length < KEEPALIVE_MAX_BYTES;
    void api(`/api/projects/${projectId}/messages`, {
      method: 'PUT',
      body: serialized,
      headers: { 'content-type': 'application/json' },
      ...(useKeepalive ? { keepalive: true } : {}),
    }).catch((err: unknown) => {
      // Swallow transient unload aborts (page reload / nav cancels keepalive
      // requests). These aren't real failures.
      if (err instanceof TypeError && /Failed to fetch/i.test(err.message)) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[chat] failed to persist messages', err);
      // Surface to user via toast so they know history wasn't saved.
      // Stable id collapses repeats during a single failure window.
      void import('../../components/Toast').then(({ showToast }) => {
        showToast({
          id: 'chat-persist-error',
          variant: 'error',
          message:
            "Couldn't save chat history. Your messages are still visible but won't survive a reload.",
        });
      });
    });
  }, []);

  // CRITICAL: useChat internally uses useRef + only re-creates the Chat instance when
  // `options.chat` or `options.id` changes (see node_modules/@ai-sdk/react/dist/index.mjs
  // line 184-190). Changing `transport` alone does NOT recreate Chat → old transport
  // is captured forever. Wiring `id` to keyTick/modelTick/chatId forces re-creation when
  // key, model OR active chat changes — chat切换 = brand new thread = fresh useChat
  // instance, so the previous chat's messages don't leak into the new tab.
  //
  // onFinish receives the chat's full state.messages including the just-completed
  // assistant message (see ai/dist/index.mjs line 13286-13288).
  const chat = useChat<DesignAgentUIMessage>({
    id: `chat-${opts.projectId}-${opts.chatId ?? 'pending'}-${keyTick}-${modelTick}`,
    transport,
    onFinish: ({ messages }) => persistThread(messages),
  });

  const { setMessages } = chat;
  const projectId = opts.projectId;
  const chatId = opts.chatId;

  // Keep a ref to the live Chat helpers so the wrapped sendMessage stays
  // referentially stable across renders (its deps are [persistThread]) while
  // still calling the latest chat.sendMessage and reading the latest chat.messages.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // Wrap sendMessage so we PUT the thread synchronously after the user message
  // is pushed into chat.messages. Vercel AI SDK v6 sendMessage is async and
  // pushes the user message synchronously before its first await (see
  // ai/dist/index.mjs line 12989), so reading chat.messages right after the
  // (non-awaited) call gives us the new thread including the user input.
  //
  // This closes the race where the user submits, sees the streaming reply,
  // then refreshes before onFinish fires — without this, the user message
  // and assistant reply both vanish on next mount.
  const sendMessage = useCallback<typeof chat.sendMessage>(
    ((...args: Parameters<typeof chat.sendMessage>) => {
      const c = chatRef.current;
      const promise = c.sendMessage(...args);
      // chat.messages now includes the freshly pushed user message.
      persistThread(c.messages);
      return promise;
    }) as typeof chat.sendMessage,
    [persistThread],
  );

  // Hydrate from persisted thread whenever the underlying Chat instance changes
  // (project switch / chat switch / BYOK key change → keyTick bump). Avoids
  // overwriting an in-flight new send by skipping when local messages is
  // already non-empty AND the chatId hasn't changed (chat switch must always
  // load that chat's thread, even if the previous chat had unsent messages —
  // useChat instance is recreated by `id` change so messages array is empty
  // when this effect fires post-switch).
  //
  // Skip while chatId is null (chat hydration in workspace state still in
  // flight). Once hydration lands, the `chatId` dep flip triggers this effect.
  useEffect(() => {
    if (!chatId) return;
    const controller = new AbortController();
    api<ListMessagesResponse>(
      `/api/projects/${projectId}/messages?chatId=${encodeURIComponent(chatId)}`,
      { signal: controller.signal },
    )
      .then(({ messages }) => {
        if (controller.signal.aborted) return;
        const loaded = messages as DesignAgentUIMessage[];
        setMessages((current) => (current.length > 0 ? current : loaded));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // Silent on transient network errors that happen during page unload /
        // navigation: browser cancels in-flight fetches → TypeError: Failed to
        // fetch. These aren't real failures, just noise.
        if (err instanceof TypeError && /Failed to fetch/i.test(err.message)) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[chat] failed to load messages', err);
      });
    return () => {
      controller.abort();
    };
  }, [projectId, chatId, keyTick, setMessages]);

  // ───── Verifier sub-agent orchestration (P2-7) ─────
  //
  // Watch the assistant message stream for new `tool-fork_verifier_agent`
  // parts that just transitioned to `output-available`. For each unseen
  // toolCallId, spawn a verifier with the current message history, await
  // the verdict, and inject it back as a new user message via
  // `chat.sendMessage`. The dedup ref prevents re-spawning on every render.
  const [verifier, setVerifier] = useState<VerifierState>({
    running: false,
    lastResult: null,
    error: null,
  });
  const processedForkCallsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const { provider } = getModelPref();
    if (!byokKey.isSet(provider)) return;
    for (const msg of chat.messages) {
      if (msg.role !== 'assistant') continue;
      for (const part of msg.parts) {
        const p = part as {
          type?: string;
          state?: string;
          toolCallId?: string;
          input?: { instructions?: string };
        };
        if (
          p.type !== 'tool-fork_verifier_agent' ||
          p.state !== 'output-available' ||
          !p.toolCallId
        ) {
          continue;
        }
        if (processedForkCallsRef.current.has(p.toolCallId)) continue;
        processedForkCallsRef.current.add(p.toolCallId);

        // Spawn verifier asynchronously and feed verdict back into main thread.
        const apiKey = byokKey.get(provider);
        if (!apiKey) continue;
        setVerifier({ running: true, lastResult: null, error: null });
        void spawnVerifier({
          projectId: opts.projectId,
          apiKey,
          provider,
          fidelity: opts.fidelity,
          designSystemId: opts.designSystemId,
          designSystemName: opts.designSystemName,
          designSystemTokensCss: opts.designSystemTokensCss,
          mainSessionId: chat.id,
          mainMessages: chat.messages,
          instructions: p.input?.instructions,
        }).then(
          (result) => {
            setVerifier({ running: false, lastResult: result, error: null });
            const c = chatRef.current;
            void c.sendMessage({ text: formatVerdictForMain(result) });
            // Persist immediately so the verdict survives a refresh.
            persistThread(c.messages);
          },
          (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            setVerifier({ running: false, lastResult: null, error });
            const c = chatRef.current;
            void c.sendMessage({
              text: `A background task has completed. Here are the results:\n\n⚠️ Verifier crashed: ${error.message}`,
            });
            persistThread(c.messages);
          },
        );
      }
    }
  }, [
    chat.messages,
    chat.id,
    opts.projectId,
    opts.fidelity,
    opts.designSystemId,
    opts.designSystemName,
    opts.designSystemTokensCss,
    persistThread,
  ]);

  return {
    messages: chat.messages,
    sendMessage,
    status: chat.status,
    error: chat.error,
    regenerate: chat.regenerate,
    stop: chat.stop,
    hasKey: byokKey.isSet(getModelPref().provider),
    refreshKey: () => setKeyTick((t) => t + 1),
    verifier,
  };
}
