import type { Todo } from '../todos-state.js';
import type { ParsedSkill } from '@/skills/registry.js';

import { copyFilesTool } from './copy-files.js';
import { copyStarterComponentTool } from './copy-starter-component.js';
import { deleteFileTool } from './delete-file.js';
import { doneTool } from './done.js';
import { evalJsTool } from './eval-js.js';
import { evalJsUserViewTool } from './eval-js-user-view.js';
import { forkVerifierTool } from './fork-verifier.js';
import { genPptxTool } from './gen-pptx.js';
import { getPublicFileUrlTool } from './get-public-file-url.js';
import { getWebviewLogsTool } from './get-webview-logs.js';
import { grepTool } from './grep.js';
import { imageMetadataTool } from './image-metadata.js';
import { invokeSkillTool } from './invoke-skill.js';
import { listFilesTool } from './list-files.js';
import {
  localCopyToProjectTool,
  localGrepTool,
  localLsTool,
  localReadTool,
} from './local-fs.js';
import { multiScreenshotTool } from './multi-screenshot.js';
import { openForPrintTool } from './open-for-print.js';
import { presentFsItemForDownloadTool } from './present-for-download.js';
import { questionsV2Tool } from './questions-v2.js';
import { readFileTool } from './read-file.js';
import { registerAssetsTool } from './register-assets.js';
import { runScriptTool } from './run-script.js';
import { saveAsTemplateTool } from './save-as-template.js';
import { saveScreenshotTool } from './save-screenshot.js';
import { screenshotTool } from './screenshot.js';
import { screenshotUserViewTool } from './screenshot-user-view.js';
import { setProjectTitleTool } from './set-project-title.js';
import { showHtmlTool } from './show-html.js';
import { showToUserTool } from './show-to-user.js';
import { sleepTool } from './sleep.js';
import { snipTool } from './snip.js';
import { strReplaceBasedEditTool } from './str-replace-based-edit-tool.js';
import { unregisterAssetsTool } from './unregister-assets.js';
import { superInlineHtmlTool } from './super-inline-html.js';
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
    copy_starter_component: copyStarterComponentTool(ctx.projectId),
    get_public_file_url: getPublicFileUrlTool(ctx.projectId),
    view_image: viewImageTool(ctx.projectId),
    image_metadata: imageMetadataTool(ctx.projectId),
    update_todos: updateTodosTool({ getChatId, onUpdate: ctx.onTodosUpdate }),
    invoke_skill: invokeSkillTool({ skills: ctx.skills }),
    web_fetch: webFetchTool(),
    done: doneTool({ getChatId }),
    // Verifier sub-agent. Both tools are present in main + verifier tool
    // sets — the FORK_BOUNDARY_PROMPT educates the verifier not to call
    // fork_verifier_agent recursively, and forbids the main agent from
    // calling verification_feedback (the latter is verifier-only). The
    // fork tool's execute() reads the active chat id at fire time via
    // `getChatId` so the same agent instance can serve multiple chats
    // without re-creating tools per chat switch.
    fork_verifier_agent: forkVerifierTool({ getChatId: () => getChatId() }),
    verification_feedback: verificationFeedbackTool(),
    // Agent v2 universal additions.
    set_project_title: setProjectTitleTool(ctx.projectId),
    show_html: showHtmlTool({ getChatId }),
    show_to_user: showToUserTool({ getChatId }),
    sleep: sleepTool(),
    local_ls: localLsTool(),
    local_read: localReadTool(),
    local_grep: localGrepTool(),
    local_copy_to_project: localCopyToProjectTool(ctx.projectId),
    snip: snipTool({ getChatId }),
    questions_v2: questionsV2Tool(),
    register_assets: registerAssetsTool(ctx.projectId),
    unregister_assets: unregisterAssetsTool(ctx.projectId),
    save_as_template: saveAsTemplateTool(ctx.projectId),
    save_screenshot: saveScreenshotTool(ctx.projectId, { getChatId }),
    run_script: runScriptTool(ctx.projectId),
    // v2 deck/PPT alignment (research §13) — Save as PDF skill calls this
    // to open the deck/document HTML in a new tab so the OS print dialog
    // can produce a clean PDF. present_fs_item_for_download is used by
    // the standalone-HTML and (future) PPTX skills to actually deliver
    // the exported artifact to the user.
    open_for_print: openForPrintTool(ctx.projectId),
    present_fs_item_for_download: presentFsItemForDownloadTool(ctx.projectId),
    // Step F — editable PPTX export via pptxgenjs. 'screenshots' mode
    // returns unsupported_mode until Step G ships.
    gen_pptx: genPptxTool(ctx.projectId),
    // Step H — inline an HTML file + all assets into a self-contained
    // single-file bundle (offline-friendly). Consumed by Save as
    // standalone HTML skill.
    super_inline_html: superInlineHtmlTool(ctx.projectId),
  };

  if (mode === 'verifier') {
    return {
      ...universal,
      eval_js: evalJsTool({ getChatId }),
      screenshot: screenshotTool({ getChatId }),
      get_webview_logs: getWebviewLogsTool({ getChatId }),
      multi_screenshot: multiScreenshotTool(ctx.projectId, { getChatId }),
    } as const;
  }

  return {
    ...universal,
    eval_js_user_view: evalJsUserViewTool({ getChatId }),
    screenshot_user_view: screenshotUserViewTool({ getChatId }),
  } as const;
}
