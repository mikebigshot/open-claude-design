import { ToolLoopAgent, stepCountIs, hasToolCall, type InferAgentUIMessage } from 'ai';
import { buildSystemMessages, buildAnthropicProviderOptions } from './system-prompt/index.js';
import { listSkills, SKILLS } from '@/skills/registry.js';
import { makeTools } from './tools/index.js';
import { getModelPref } from '@/lib/model-pref.js';
import { buildLanguageModel } from '@/lib/llm-providers.js';
import type { Todo } from './todos-state.js';
import { type Fidelity, type LLMProvider } from '@open-design/contracts';
import { wrapToolsForVerifierMode } from './verifier.js';
import { makePrepareStep } from './agent-prepare-step.js';
import type { RegisteredSnip } from './loop-helpers/snip-applier.js';

/**
 * Agent mode: controls the loop's `stopWhen` and the tool subset.
 *
 * - `main`: 20-step ceiling (failsafe). Caller drives the loop via user
 *   messages; expected to terminate by calling the `done` tool.
 * - `verifier`: terminates the moment `verification_feedback` is called.
 *   Mutating tools (write_file / str_replace / delete_file / copy_files /
 *   done / update_todos / fork_verifier_agent) are **not** removed from
 *   the tool set ("trust the prompt, don't narrow API"); the
 *   FORK_BOUNDARY_PROMPT educates the verifier not to call them.
 */
export type AgentMode = 'main' | 'verifier';

export interface CreateAgentOptions {
  projectId: string;
  apiKey: string;
  /**
   * Provider the agent talks to (BYOK selects the matching key + SDK
   * provider). Optional fallback to current `getModelPref().provider` to
   * keep existing single-arg call sites working.
   */
  provider?: LLMProvider;
  fidelity?: Fidelity;
  designSystemId?: string;
  designSystemName?: string;
  designSystemTokensCss?: string;
  claudeMdContent?: string;
  onTodosUpdate: (todos: Todo[]) => void;
  /** Default `'main'`. Pass `'verifier'` to swap the stopWhen condition. */
  mode?: AgentMode;
  /**
   * §2.1 — return the snip ranges currently registered for this chat.
   * When present, the prepareStep callback uses these to prune the message
   * history once the token estimate crosses `snipThreshold`. Will be wired
   * to W2's snip tool registry once that lands; for now defaults to no-op.
   *
   * TODO(W1→W2 merge): swap the default to read from W2's snip-state map.
   */
  getRegisteredSnips?: () => readonly RegisteredSnip[];
  /**
   * Token threshold above which prepareStep applies pending snips.
   * Defaults to a conservative 80 000 tokens (≈80% of a 100k window) so
   * the buffer is wide. Caller may pass `model.maxTokens * 0.7` if known.
   */
  snipThreshold?: number;
}

/**
 * Per-project ToolLoopAgent. BYOK via the provider chosen in
 * `getModelPref().provider`. The model id is also resolved from
 * localStorage so the picker → re-create chain stays in `useAgentChat`.
 *
 * Caller is responsible for re-creating the agent when projectId, apiKey,
 * provider, or onTodosUpdate changes (use useMemo with these deps).
 */
export function createAgent(opts: CreateAgentOptions) {
  const pref = getModelPref();
  const provider = opts.provider ?? pref.provider;
  const skillSummaries = listSkills().map((s) => ({
    name: s.frontmatter.name,
    description: s.frontmatter.description,
  }));
  const mode: AgentMode = opts.mode ?? 'main';
  const snipThreshold = opts.snipThreshold ?? 80_000;
  const prepareStep = makePrepareStep({
    getRegisteredSnips: opts.getRegisteredSnips,
    threshold: snipThreshold,
  });
  // §4.1 cross-W wire: adaptive thinking + output_config.effort go into
  // providerOptions.anthropic so the Anthropic-routed providers (anthropic
  // direct + openrouter passthrough) can pick them up. Non-Anthropic
  // providers ignore unknown keys.
  const anthropicProviderOptions = buildAnthropicProviderOptions();

  return new ToolLoopAgent({
    model: buildLanguageModel(provider, opts.apiKey, pref.modelId),
    instructions: buildSystemMessages({
      provider,
      skills: skillSummaries,
      designSystemId: opts.designSystemId,
      claudeMdContent: opts.claudeMdContent,
      userEmailDomain: undefined,
    }) as never,
    tools: wrapToolsForVerifierMode(
      makeTools({
        projectId: opts.projectId,
        skills: SKILLS,
        onTodosUpdate: opts.onTodosUpdate,
      }),
      mode,
    ),
    // §2.1 — automatically apply pending snips before each step when the
    // running token estimate crosses `snipThreshold`. Cast to satisfy the
    // SDK's PrepareStepFunction shape (we keep the helper signature loose
    // so it stays unit-testable without the AI SDK's full type chain).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepareStep: prepareStep as any,
    // §4.1 — adaptive thinking + output_config.effort. AI SDK passes
    // `providerOptions` through to the underlying streamText; unknown keys
    // are forwarded verbatim to the wire.
    providerOptions: { anthropic: anthropicProviderOptions } as never,
    stopWhen:
      mode === 'verifier'
        ? // Verifier exits the moment it calls verification_feedback. Step
          // ceiling kept as a hard failsafe in case the verifier loops on
          // read_file without ever firing the verdict tool.
          [hasToolCall('verification_feedback'), stepCountIs(15)]
        : stepCountIs(20),
  });
}

// Re-export for convenience so consumers can get the UIMessage type without
// a separate import of ui-messages.ts.
export type { InferAgentUIMessage };
