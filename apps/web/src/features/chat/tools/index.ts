import type { Todo } from '../todos-state.js';
import type { ParsedSkill } from '@/skills/registry.js';

import { copyFilesTool } from './copy-files.js';
import { deleteFileTool } from './delete-file.js';
import { doneTool } from './done.js';
import { forkVerifierTool } from './fork-verifier.js';
import { grepTool } from './grep.js';
import { invokeSkillTool } from './invoke-skill.js';
import { listFilesTool } from './list-files.js';
import { readFileTool } from './read-file.js';
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
}

export function makeTools(ctx: MakeToolsContext) {
  return {
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
  } as const;
}
