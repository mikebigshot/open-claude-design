// Renders one UIMessage from the AI SDK ToolLoopAgent.
//
// Message shape: { id, role: 'user' | 'assistant', parts: Part[] }
//
// Part types rendered:
//   - text                       → prose bubble (user = grey bg, assistant = logo header)
//   - file (image/*)             → thumbnail row inside user bubble (preserves history)
//   - tool-questions_v2          → inline <QuestionsForm> (interactive — submit / cancel
//                                    callbacks bubble back to ChatPanel)
//   - tool-{write,read,…}_file   → verb chip ("Writing <path>", "Reading <path>", …)
//                                    Verb map covers every shipped agent tool — see
//                                    `toolDisplay` switch below.
//   - anything else isToolUIPart → typed fallback: lowercased-with-spaces name +
//                                    inputPath/inputMessage as best-effort target
//                                    (no truncation; F1.2 regression guard)
//
// State machine per tool part (from common-errors.md):
//   input-streaming  → spinner / "…"
//   input-available  → executing
//   output-available → finished
//   output-error     → error
//
// F1.1 — questions_v2 form wiring: when ChatPanel passes `onSubmitQuestions`
// (and optional `onCancelQuestions` + `handledToolCallIds`), the questions_v2
// tool part renders an inline <QuestionsForm> instead of a verb chip. ChatPanel
// stitches answers back into the conversation by calling chat.sendMessage()
// with the formatted JSON payload. After the user submits or cancels, the
// toolCallId is added to a "handled" set so the form unmounts (avoids the
// user re-submitting the same form on re-render).

import styled, { useTheme } from 'styled-components';
import { isToolUIPart } from 'ai';
import { useT } from '@/i18n';
import { IconLogo } from './icons';
import { formatAnswers, QuestionsForm } from './QuestionsForm';
import type { QuestionsV2InputT } from './tools/questions-v2';
import { stripAttachmentBlocks } from './strip-attachment-blocks';
import type { DesignAgentUIMessage } from './ui-messages';

type TFn = ReturnType<typeof useT>;

interface Props {
  message: DesignAgentUIMessage;
  /**
   * Called when the user submits a tool-questions_v2 form. `text` is already
   * formatted JSON via formatAnswers() — ChatPanel forwards it as the next
   * user message via chat.sendMessage({ text }). If absent, ChatMsg renders
   * the form as read-only and submit does nothing (safe default for tests
   * that don't care about the wiring).
   */
  onSubmitQuestions?: (toolCallId: string, text: string) => void;
  /**
   * Called when the user clicks Cancel on a questions_v2 form. ChatPanel
   * forwards "Skipped all questions — proceed with your best judgment." as
   * a new user message so the agent can resume.
   */
  onCancelQuestions?: (toolCallId: string) => void;
  /**
   * Tool call ids whose interactive UI has already been answered (submitted
   * or cancelled). Lives in ChatPanel's local state to survive re-renders;
   * passed in so ChatMsg can hide the form once it's done.
   */
  handledToolCallIds?: ReadonlySet<string>;
}

// ───── styled components ─────

const UserBubble = styled.div`
  margin-bottom: 18px;
  padding: 10px 12px;
  background: ${(p) => p.theme.colors.bg200};
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.55;
  white-space: pre-wrap;
`;

// User-attached image preview row inside UserBubble — square 88×88 with
// generous radius, matches claude.ai/design's chat-history thumbnail style
// (portrait shape is reserved for the composer's pre-send staging area).
const UserAttachments = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
`;

const UserAttachmentImg = styled.img`
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid ${(p) => p.theme.colors.line100};
  display: block;
`;

// v2 attachment chips — small pill-shaped labels under the user bubble
// that surface skill / design-system / file attachments the user picked
// before sending. The actual content is inlined into the LLM-bound text
// elsewhere (W1's wrapped sendMessage + W3's inlineAttachmentsIntoText
// helper); these chips are presentation only.
const AttachmentChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
`;

const AttachmentChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => p.theme.colors.bg50};
  color: ${(p) => p.theme.colors.fg300};
  font-size: 11px;
  line-height: 1.5;
`;

const AttachmentChipKind = styled.span`
  color: ${(p) => p.theme.colors.fg400};
  font-weight: 500;
`;

const AtelierBlock = styled.div`
  margin-bottom: 16px;
  font-size: 13.5px;
  line-height: 1.6;
`;

const AtelierHeader = styled.div`
  font-size: 11px;
  color: ${(p) => p.theme.colors.fg400};
  margin-bottom: 4px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const AtelierText = styled.div`
  white-space: pre-wrap;
`;

const MonoFramedBlock = styled.div`
  margin-bottom: 16px;
  padding: 10px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 10px;
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 11px;
`;

const ToolRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
`;

const ToolVerb = styled.span<{ $color: string }>`
  color: ${(p) => p.$color};
  font-weight: 600;
  width: 60px;
  font-size: 10.5px;
`;

const ToolTarget = styled.span`
  color: ${(p) => p.theme.colors.fg200};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
`;

const ToolStateBadge = styled.span<{ $state: string }>`
  margin-left: auto;
  font-size: 9px;
  color: ${(p) => {
    switch (p.$state) {
      case 'output-available':
        return p.theme.colors.success ?? '#22c55e';
      case 'output-error':
      case 'output-denied':
        return p.theme.colors.danger ?? '#ef4444';
      default:
        return p.theme.colors.fg400 ?? '#888';
    }
  }};
`;

// ───── present_fs_item_for_download — chat-history download card ─────
//
// Rendered inline in the assistant message stream (NOT inside the framed
// tool block) so the user can re-trigger a download of a single file from
// history. Folder/project zips are ephemeral (object URL revoked after
// click) — those cards stay informational and announce "Downloaded N B".

const DownloadCard = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 10px;
  font-size: 12.5px;
  line-height: 1.4;
`;

const DownloadCardBody = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const DownloadCardName = styled.span`
  font-weight: 600;
  color: ${(p) => p.theme.colors.fg100};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DownloadCardMeta = styled.span`
  font-size: 11px;
  color: ${(p) => p.theme.colors.fg300};
`;

const DownloadCardLink = styled.a`
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 999px;
  background: ${(p) => p.theme.colors.bg100 ?? 'transparent'};
  color: ${(p) => p.theme.colors.fg100};
  text-decoration: none;
  font-size: 11.5px;

  &:hover,
  &:focus {
    background: ${(p) => p.theme.colors.bg200};
    outline: none;
  }
`;

const DownloadCardError = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.danger ?? '#ef4444'};
  border-radius: 10px;
  font-size: 12.5px;
  color: ${(p) => p.theme.colors.danger ?? '#ef4444'};
`;

const DownloadCardPlaceholder = styled.div`
  margin-bottom: 12px;
  padding: 10px 12px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px dashed ${(p) => p.theme.colors.line100};
  border-radius: 10px;
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg300};
`;

/** Human-readable size — 24576 → "24.0 KB", 1500000 → "1.4 MB". */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return `${n} B`;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Derive the display filename for the download card. For kind=file the
 *  label is already the basename; for folder/project it's a stem that we
 *  decorate with `.zip` to make it obvious to the user. */
function downloadFilename(out: {
  kind: 'file' | 'folder' | 'project';
  label: string;
}): string {
  if (out.kind === 'file') return out.label;
  return `${out.label}.zip`;
}

// ───── component ─────

export function ChatMsg({
  message,
  onSubmitQuestions,
  onCancelQuestions,
  handledToolCallIds,
}: Props) {
  const theme = useTheme();
  const t = useT();

  const isUser = message.role === 'user';

  if (isUser) {
    // User messages: text parts as bubble text + image file parts as thumbnail row.
    // Without the file-part branch, paste/upload attachments disappear from chat
    // history after send (regression observed against claude.ai/design parity).
    const rawText = message.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('');
    // sendMessage in use-agent-chat.ts inlines skill / designSystem / file
    // attachments as XML wrappers before the user prose for the LLM. Strip
    // them out of the user-visible bubble; the chip surface stays.
    const stripped = stripAttachmentBlocks(rawText);
    const textContent = stripped.visibleText;
    const imageParts = message.parts.filter(
      (p): p is Extract<typeof p, { type: 'file' }> =>
        p.type === 'file' && (p.mediaType?.startsWith('image/') ?? false),
    );
    const attachments = message.attachments;

    return (
      <UserBubble>
        {textContent || (imageParts.length === 0 ? ' ' : null)}
        {imageParts.length > 0 && (
          <UserAttachments>
            {imageParts.map((p, i) => (
              <UserAttachmentImg
                key={`img-${i}`}
                src={p.url}
                alt={('filename' in p && p.filename) || 'attached image'}
              />
            ))}
          </UserAttachments>
        )}
        {attachments && attachments.length > 0 ? (
          <AttachmentChips>
            {attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                data-testid={`attachment-chip-${att.id}`}
                title={att.name}
              >
                <AttachmentChipKind>{labelForAttachmentType(att.type)}:</AttachmentChipKind>
                {att.name}
              </AttachmentChip>
            ))}
          </AttachmentChips>
        ) : stripped.chips.length > 0 ? (
          // Fallback: persisted thread without attachments[] (P2 pending) —
          // synthesise chips from the stripped XML so the reader still sees
          // what was attached.
          <AttachmentChips>
            {stripped.chips.map((chip, i) => (
              <AttachmentChip
                key={`stripped-${i}`}
                data-testid={`attachment-chip-stripped-${i}`}
                title={chip.name}
              >
                <AttachmentChipKind>{labelForStrippedType(chip.type)}:</AttachmentChipKind>
                {chip.name}
              </AttachmentChip>
            ))}
          </AttachmentChips>
        ) : null}
      </UserBubble>
    );
  }

  // Assistant messages: render parts in order.
  // Group consecutive tool parts into a single framed block for visual coherence.
  // tool-questions_v2 is the lone exception — it renders an interactive form
  // OUTSIDE the framed tool block (full bleed) so the radios / sliders / etc.
  // are large enough to use comfortably.
  const elements: React.ReactNode[] = [];
  let toolBuffer: React.ReactNode[] = [];

  const flushTools = () => {
    if (toolBuffer.length === 0) return;
    elements.push(<MonoFramedBlock key={`tools-${elements.length}`}>{toolBuffer}</MonoFramedBlock>);
    toolBuffer = [];
  };

  message.parts.forEach((part, i) => {
    if (part.type === 'text') {
      flushTools();
      if (part.text) {
        elements.push(
          <AtelierBlock key={`text-${i}`}>
            <AtelierHeader>
              <IconLogo size={11} /> Atelier
            </AtelierHeader>
            <AtelierText>{part.text}</AtelierText>
          </AtelierBlock>,
        );
      }
    } else if (isToolUIPart(part)) {
      const generic = asGenericTool(part);
      // F1.1 — questions_v2: render <QuestionsForm> inline once input is
      // available, hide once handled. While still streaming the input we
      // skip rendering entirely (input fields may be partial / invalid).
      if (generic.type === 'tool-questions_v2') {
        flushTools();
        const handled = handledToolCallIds?.has(generic.toolCallId) ?? false;
        const ready =
          (generic.state === 'output-available' || generic.state === 'input-available') && !handled;
        if (ready) {
          // Defensive: the agent could send a malformed input. Validate
          // minimal shape (title + questions array) before mounting; fall
          // back to the verb chip if invalid so we don't crash the panel.
          const input = generic.input as Partial<QuestionsV2InputT> | undefined;
          if (input && Array.isArray(input.questions)) {
            elements.push(
              <QuestionsForm
                key={`q-${i}-${generic.toolCallId}`}
                data={{
                  title: input.title ?? '',
                  questions: input.questions,
                }}
                onSubmit={(answers) => {
                  onSubmitQuestions?.(generic.toolCallId, formatAnswers(answers));
                }}
                onCancel={() => onCancelQuestions?.(generic.toolCallId)}
              />,
            );
            return; // skip verb chip
          }
        } else {
          // Form already handled (submitted/cancelled) or still streaming —
          // render nothing for this part. Skipping the chip is intentional:
          // once the user has acted, the form's value is the agent's next
          // user message, not a separate tool-call breadcrumb.
          return;
        }
      }
      // US-003 — present_fs_item_for_download renders an inline download
      // card (not a framed verb chip). Files get a re-clickable <a download>
      // anchor pointed at the worker URL; folder/project zips are ephemeral
      // and stay informational.
      if (generic.type === 'tool-present_fs_item_for_download') {
        flushTools();
        if (generic.state === 'input-streaming') {
          elements.push(
            <DownloadCardPlaceholder key={`dl-${i}-${generic.toolCallId}`}>
              Preparing download…
            </DownloadCardPlaceholder>,
          );
          return;
        }
        const output = generic.output as
          | {
              ok: true;
              kind: 'file' | 'folder' | 'project';
              path: string;
              label: string;
              bytes: number;
              downloadUrl?: string;
            }
          | { ok: false; error: string; message: string }
          | undefined;
        if (output && output.ok === false) {
          elements.push(
            <DownloadCardError
              key={`dl-${i}-${generic.toolCallId}`}
              role="status"
              aria-live="polite"
            >
              <strong>Download failed</strong>
              <span>{output.message}</span>
            </DownloadCardError>,
          );
          return;
        }
        if (output && output.ok) {
          const filename = downloadFilename(output);
          const size = formatBytes(output.bytes);
          if (output.kind === 'file' && output.downloadUrl) {
            elements.push(
              <DownloadCard key={`dl-${i}-${generic.toolCallId}`}>
                <DownloadCardBody>
                  <DownloadCardName>{filename}</DownloadCardName>
                  <DownloadCardMeta>{size}</DownloadCardMeta>
                </DownloadCardBody>
                <DownloadCardLink
                  href={output.downloadUrl}
                  download={filename}
                  aria-label={`Download ${filename}`}
                >
                  Download
                </DownloadCardLink>
              </DownloadCard>,
            );
          } else {
            // Folder / project — informational (zip is ephemeral).
            elements.push(
              <DownloadCard key={`dl-${i}-${generic.toolCallId}`} role="status" aria-live="polite">
                <DownloadCardBody>
                  <DownloadCardName>{filename}</DownloadCardName>
                  <DownloadCardMeta>Downloaded · {size}</DownloadCardMeta>
                </DownloadCardBody>
              </DownloadCard>,
            );
          }
          return;
        }
        // No output yet at output-available — render placeholder.
        elements.push(
          <DownloadCardPlaceholder key={`dl-${i}-${generic.toolCallId}`}>
            Preparing download…
          </DownloadCardPlaceholder>,
        );
        return;
      }
      // Generic verb chip path for all other tools (including questions_v2
      // when input shape is unusable).
      const { verb, verbColor, target } = toolDisplay(part, theme, t);
      toolBuffer.push(
        <ToolRow key={`tool-${i}-${generic.toolCallId}`}>
          <ToolVerb $color={verbColor}>{verb}</ToolVerb>
          {target && <ToolTarget title={target}>{target}</ToolTarget>}
          <ToolStateBadge $state={generic.state}>{stateLabel(generic.state)}</ToolStateBadge>
        </ToolRow>,
      );
    }
  });

  flushTools();

  return <>{elements}</>;
}

// ───── helpers ─────

/** Generic tool part shape we extract from the SDK's discriminated union. */
interface GenericToolPart {
  type: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  toolCallId: string;
  toolName?: string;
}

/** Cast a tool UI part to a generic shape we can safely read. */
function asGenericTool(part: unknown): GenericToolPart {
  return part as GenericToolPart;
}

/**
 * Verb-chip map for every shipped agent tool. Mirrors the v1 verb table
 * (Reading/Writing/Editing/Copying/Done) and rounds out the v2 surface:
 * grep / delete / view_image / web_fetch / snip / update_todos / questions_v2 /
 * register_assets / invoke_skill / fork_verifier_agent / verification_feedback /
 * preview tools (screenshot / eval_js / get_webview_logs / multi_screenshot,
 * plus their `_user_view` siblings).
 *
 * F1.2 — generic fallback used to slice the upper-cased name to 8 chars,
 * which produced things like `WRITE_FI`, `STR_REPL`, `REGISTER`. We now
 * (a) wire every shipped tool explicitly and (b) fall back to a friendly
 * lowercased-with-spaces form for unknown types ("custom_thing" → "custom
 * thing") so users can still read what the agent did.
 */
function toolDisplay(
  rawPart: unknown,
  theme: { colors: Record<string, string | undefined>; fonts: Record<string, string | undefined> },
  t: TFn,
): { verb: string; verbColor: string; target: string } {
  const part = asGenericTool(rawPart);

  const c = (key: string) => theme.colors[key] ?? '#888';

  // Best-effort target derivation. Different tools surface different input
  // keys; we pick the most user-meaningful one per tool below, with a
  // generic "first string-valued input field" fallback at the bottom.
  const input = part.input ?? {};
  const inputPath = input.path as string | undefined;
  const inputMessage = input.message as string | undefined;
  const inputSummary = input.summary as string | undefined;

  switch (part.type) {
    // ── file writes ──
    // `tool-edit_file` is the legacy name from v1 — kept so any historical
    // messages still render correctly. Current tool name is `tool-write_file`.
    case 'tool-write_file':
    case 'tool-edit_file':
      return {
        verb: t('chat.tool.writing'),
        verbColor: c('info'),
        target: inputPath ?? '',
      };
    case 'tool-str_replace_based_edit_tool':
      return {
        verb: t('chat.tool.editing'),
        verbColor: c('info'),
        target: inputPath ?? '',
      };
    // ── file reads / navigation ──
    case 'tool-read_file':
      return {
        verb: t('chat.tool.reading'),
        verbColor: c('fg300'),
        target: inputPath ?? '',
      };
    case 'tool-list_files':
      return {
        verb: t('chat.tool.listing'),
        verbColor: c('fg300'),
        target: inputPath ?? 'files',
      };
    case 'tool-grep':
      return {
        verb: t('chat.tool.grep'),
        verbColor: c('fg300'),
        target: (input.pattern as string | undefined) ?? '',
      };
    // ── file mutations ──
    case 'tool-copy_files':
      return {
        verb: t('chat.tool.copying'),
        verbColor: c('info'),
        // Prefer "from → to" if both present, fall back to from or to alone.
        target: (() => {
          const from = input.from as string | undefined;
          const to = input.to as string | undefined;
          if (from && to) return `${from} → ${to}`;
          return from ?? to ?? '';
        })(),
      };
    case 'tool-delete_file':
      return {
        verb: t('chat.tool.deleting'),
        verbColor: c('danger'),
        target: inputPath ?? '',
      };
    case 'tool-view_image':
      return {
        verb: t('chat.tool.viewing'),
        verbColor: c('fg300'),
        target: inputPath ?? '',
      };
    // ── web / fetch ──
    case 'tool-web_fetch':
      return {
        verb: t('chat.tool.fetching'),
        verbColor: c('fg300'),
        target: (input.url as string | undefined) ?? '',
      };
    // ── done (v2 name is `tool-done`; legacy was `tool-mark_done`) ──
    case 'tool-done':
    case 'tool-mark_done':
      return {
        verb: t('chat.tool.done'),
        verbColor: c('success'),
        target: inputSummary ?? inputMessage ?? '',
      };
    // ── v2 context management ──
    case 'tool-snip':
      return {
        verb: t('chat.tool.snipping'),
        verbColor: c('fg300'),
        target: (() => {
          const from = input.from_id as string | undefined;
          const to = input.to_id as string | undefined;
          if (from && to) return `${from} → ${to}`;
          return from ?? to ?? '';
        })(),
      };
    case 'tool-update_todos':
      return {
        verb: t('chat.tool.todos'),
        verbColor: c('fg300'),
        target: (() => {
          const todos = input.todos as Array<{ status?: string }> | undefined;
          if (!Array.isArray(todos)) return '';
          const total = todos.length;
          const done = todos.filter((td) => td.status === 'completed').length;
          return `${done}/${total}`;
        })(),
      };
    // ── v2 assets / skills ──
    case 'tool-register_assets':
      return {
        verb: t('chat.tool.registering'),
        verbColor: c('fg300'),
        target: (() => {
          const assets = input.assets as Array<unknown> | undefined;
          return Array.isArray(assets) ? `${assets.length} item(s)` : '';
        })(),
      };
    case 'tool-invoke_skill':
      return {
        verb: t('chat.tool.skill'),
        verbColor: c('brandBase'),
        target: (input.name as string | undefined) ?? '',
      };
    // ── v2 verifier ──
    case 'tool-fork_verifier_agent':
      return {
        verb: t('chat.tool.verifying'),
        verbColor: c('brandBase'),
        target: (input.task as string | undefined) ?? '',
      };
    case 'tool-verification_feedback':
      return {
        verb: t('chat.tool.feedback'),
        verbColor: c('fg300'),
        target: (input.verdict as string | undefined) ?? '',
      };
    // ── v2 questions (interactive form is rendered above; this branch
    //    is only hit when ChatPanel hasn't passed onSubmitQuestions or
    //    when the input shape is unusable) ──
    case 'tool-questions_v2':
      return {
        verb: t('chat.tool.questioning'),
        verbColor: c('fg300'),
        target: (input.title as string | undefined) ?? '',
      };
    // ── v2 preview tools (main + verifier surfaces) ──
    case 'tool-screenshot':
    case 'tool-screenshot_user_view':
    case 'tool-multi_screenshot':
      return {
        verb: t('chat.tool.screenshotting'),
        verbColor: c('fg300'),
        target: (input.selector as string | undefined) ?? (input.url as string | undefined) ?? '',
      };
    case 'tool-eval_js':
    case 'tool-eval_js_user_view':
      return {
        verb: t('chat.tool.evaluating'),
        verbColor: c('fg300'),
        target: '',
      };
    case 'tool-get_webview_logs':
      return {
        verb: t('chat.tool.logs'),
        verbColor: c('fg300'),
        target: '',
      };
    // ── v2 deck/PPT alignment tools (research §13) ──
    case 'tool-open_for_print':
      return {
        verb: t('chat.tool.opening'),
        verbColor: c('fg300'),
        target: (input.project_relative_file_path as string | undefined) ?? '',
      };
    case 'tool-present_fs_item_for_download':
      return {
        verb: t('chat.tool.downloading'),
        verbColor: c('fg300'),
        target: (input.label as string | undefined) ?? (input.path as string | undefined) ?? '',
      };
    case 'tool-gen_pptx':
      return {
        verb: t('chat.tool.exporting'),
        verbColor: c('fg300'),
        target:
          (input.outputFilename as string | undefined) ??
          ((input.mode as string | undefined) === 'screenshots' ? 'PPTX (screenshots)' : 'PPTX'),
      };
    case 'tool-super_inline_html':
      return {
        verb: t('chat.tool.bundling'),
        verbColor: c('fg300'),
        target: (input.output_path as string | undefined) ?? (input.input_path as string | undefined) ?? '',
      };
    default: {
      // Generic fallback — never truncate (F1.2 regression guard). For an
      // unknown tool "tool-some_new_thing" we render "some new thing" as
      // the verb. Target tries inputPath / inputMessage / first string-valued
      // field in the input object so users still get a useful breadcrumb.
      const name = part.type.startsWith('tool-') ? part.type.slice(5) : part.type;
      const friendly = name.replaceAll('_', ' ');
      const firstStringField = (() => {
        for (const v of Object.values(input)) {
          if (typeof v === 'string' && v.length > 0) return v;
        }
        return '';
      })();
      return {
        verb: friendly,
        verbColor: c('fg300'),
        target: inputPath ?? inputMessage ?? inputSummary ?? firstStringField,
      };
    }
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'input-streaming':
      return '…';
    case 'input-available':
      return '⟳';
    case 'output-available':
      return '✓';
    case 'output-error':
      return '✗';
    case 'output-denied':
      return '✗';
    default:
      return '';
  }
}

/**
 * v2 attachment types → user-facing chip label. Kept terse; the chip is
 * already small. The full content is in the message body via the inlining
 * pipeline (W3 helper, W1 wires it up at sendMessage).
 */
function labelForAttachmentType(
  type: 'skill' | 'designSystem' | 'file' | 'canvas' | 'folder',
): string {
  switch (type) {
    case 'skill':
      return 'skill';
    case 'designSystem':
      return 'design system';
    case 'file':
      return 'file';
    case 'canvas':
      return 'canvas';
    case 'folder':
      return 'folder';
  }
}

/**
 * Like `labelForAttachmentType` but accepts the open-vocabulary string that
 * `stripAttachmentBlocks` extracts from `<attachment type="...">` wrappers.
 * Falls back to the raw type for unknown kinds so we never silently drop
 * information from a persisted thread.
 */
function labelForStrippedType(type: string): string {
  switch (type) {
    case 'skill':
      return 'skill';
    case 'designSystem':
      return 'design system';
    case 'file':
      return 'file';
    case 'canvas':
      return 'canvas';
    case 'folder':
      return 'folder';
    default:
      return type;
  }
}
