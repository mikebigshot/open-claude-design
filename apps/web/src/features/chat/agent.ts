import { ToolLoopAgent, stepCountIs, hasToolCall, type InferAgentUIMessage } from 'ai';
import { buildSystemMessages } from './system-prompt/index.js';
import { listSkills, SKILLS } from '@/skills/registry.js';
import { makeTools } from './tools/index.js';
import { getModelPref } from '@/lib/model-pref.js';
import { buildLanguageModel } from '@/lib/llm-providers.js';
import type { Todo } from './todos-state.js';
import { type Fidelity, type LLMProvider } from '@open-design/contracts';

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
  return new ToolLoopAgent({
    model: buildLanguageModel(provider, opts.apiKey, pref.modelId),
    instructions: buildSystemMessages({
      provider,
      skills: skillSummaries,
      designSystemId: opts.designSystemId,
      claudeMdContent: opts.claudeMdContent,
      userEmailDomain: undefined,
    }) as never,
    tools: makeTools({
      projectId: opts.projectId,
      skills: SKILLS,
      onTodosUpdate: opts.onTodosUpdate,
    }),
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
