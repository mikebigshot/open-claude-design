import type { Todo } from '../todos-state.js';
import type { ParsedSkill } from '@/skills/registry.js';

import { copyFilesTool } from './copy-files.js';
import { deleteFileTool } from './delete-file.js';
import { doneTool } from './done.js';
import { evalJsTool } from './eval-js.js';
import { evalJsUserViewTool } from './eval-js-user-view.js';
import { forkVerifierTool } from './fork-verifier.js';
import { getWebviewLogsTool } from './get-webview-logs.js';
import { grepTool } from './grep.js';
import { invokeSkillTool } from './invoke-skill.js';
import { listFilesTool } from './list-files.js';
import { multiScreenshotTool } from './multi-screenshot.js';
import { questionsV2Tool } from './questions-v2.js';
import { readFileTool } from './read-file.js';
import { registerAssetsTool } from './register-assets.js';
import { screenshotTool } from './screenshot.js';
import { screenshotUserViewTool } from './screenshot-user-view.js';
import { snipTool } from './snip.js';
import { strReplaceBasedEditTool } from './str-replace-based-edit-tool.js';
import { updateTodosTool } from './update-todos.js';
import { verificationFeedbackTool } from './verification-feedback.js';
import { viewImageTool } from './view-image.js';
import { webFetchTool } from './web-fetch.js';
import { writeFileTool } from './write-file.js';

export interface MakeToolsContext {
  projectId: string;
  skills: Record<string, ParsedSkill>;
  onTodosUpdate: (todos: Todo[]) => void;
  /**
   * Tool surface mode. 'main' (default) for the user-facing agent, 'verifier'
   * for the QA sub-agent spawned by `fork_verifier_agent`. The two surfaces
   * differ in their preview-tool set:
   *   - main mode: eval_js_user_view + screenshot_user_view
   *   - verifier mode: eval_js + screenshot + get_webview_logs + multi_screenshot
   * Universal tools (snip / questions_v2 / register_assets + the 14 baseline
   * tools) are present in both.
   */
  mode?: 'main' | 'verifier';
  /**
   * Provider for the active chat id. Required by `snip` (registry is per-chat)
   * and by the iframe-bridge for preview-side tools (used to find the matching
   * `<iframe data-chat-id>` element). Defaults to `() => 'default'` so tests
   * can omit it.
   */
  getChatId?: () => string;
}

export function makeTools(ctx: MakeToolsContext) {
  const mode = ctx.mode ?? 'main';
  const getChatId = ctx.getChatId ?? (() => 'default');

  // Universal — present in both main and verifier surfaces.
  const universal = {
    write_file: writeFileTool(ctx.projectId),
    read_file: readFileTool(ctx.projectId),
    list_files: listFilesTool(ctx.projectId),
    str_replace_based_edit_tool: strReplaceBasedEditTool(ctx.projectId),
    grep: grepTool(ctx.projectId),
    delete_file: deleteFileTool(ctx.projectId),
    copy_files: copyFilesTool(ctx.projectId),
    view_image: viewImageTool(ctx.projectId),
    update_todos: updateTodosTool({ onUpdate: ctx.onTodosUpdate }),
    invoke_skill: invokeSkillTool({ skills: ctx.skills }),
    web_fetch: webFetchTool(),
    done: doneTool(),
    // Verifier sub-agent (P2-7). Both tools are present in main + verifier
    // tool sets — the FORK_BOUNDARY_PROMPT educates the verifier not to call
    // fork_verifier_agent recursively, and forbids the main agent from
    // calling verification_feedback (the latter is verifier-only).
    fork_verifier_agent: forkVerifierTool(),
    verification_feedback: verificationFeedbackTool(),
    // Agent v2 universal additions.
    snip: snipTool({ getChatId }),
    questions_v2: questionsV2Tool(),
    register_assets: registerAssetsTool(ctx.projectId),
  };

  if (mode === 'verifier') {
    return {
      ...universal,
      eval_js: evalJsTool({ getChatId }),
      screenshot: screenshotTool({ getChatId }),
      get_webview_logs: getWebviewLogsTool({ getChatId }),
      multi_screenshot: multiScreenshotTool({ getChatId }),
    } as const;
  }

  return {
    ...universal,
    eval_js_user_view: evalJsUserViewTool({ getChatId }),
    screenshot_user_view: screenshotUserViewTool({ getChatId }),
  } as const;
}
