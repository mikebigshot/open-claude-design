// questions_v2 — present a structured question form to the user. The tool's
// execute() is signal-only: it returns "Questions sent. End your turn..." so
// the agent ends its turn while the UI renders <QuestionsForm>. The user's
// answers are stitched back via chat.sendMessage() with formatAnswers().
//
// Source v2 verbatim: artifacts/tools/tools-full-schema.json (questions_v2 entry).
//   - 5 kinds: text-options / svg-options / slider / file / freeform
//   - Required fields per question: id, kind, title
//   - Top-level required: title, questions

import { tool } from 'ai';
import { z } from 'zod';

const QUESTIONS_V2_DESCRIPTION = `Present a structured question form to the user for gathering design preferences. Use liberally when starting something new or the ask is ambiguous. Call AFTER reading files and research, BEFORE planning or building.

Output a JSON blob (NOT html). The UI renders native components for each question. Questions stream in as you write them — keep the most important ones first.

Question kinds:
- text-options — radio (single) or checkbox (multi) pick from a list of text labels. ALWAYS include these two options: "Explore a few options" and "Decide for me". Also include "Other" for open-ended input.
- svg-options — same but each option is an inline SVG string (~80×56 viewBox). Use for visual choices: layouts, icon styles, color swatches rendered as SVG.
- slider — numeric range with min/max/step/default. Be generous with ranges; users often want to go further than you'd expect. Only tight-bound when physically meaningful (opacity 0-1, volume 0-100).
- file — file picker. User-uploaded file is written to uploads/ and the project-relative path is returned as the answer.
- freeform — plain textarea for open-ended input.

Keep titles short, subtitles optional. It's better to ask too many questions than too few.`;

export const QuestionKind = z.enum(['text-options', 'svg-options', 'slider', 'file', 'freeform']);
export type QuestionKindT = z.infer<typeof QuestionKind>;

export const QuestionSchema = z.object({
  id: z.string().describe('snake_case answer key'),
  kind: QuestionKind,
  title: z.string(),
  subtitle: z.string().optional(),
  options: z.array(z.string()).optional(),
  multi: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.number().optional(),
  accept: z.string().optional(),
});
export type QuestionT = z.infer<typeof QuestionSchema>;

export const QuestionsV2Input = z.object({
  title: z.string().describe('Overall form title, e.g. "Quick questions about the landing page"'),
  questions: z.array(QuestionSchema),
});
export type QuestionsV2InputT = z.infer<typeof QuestionsV2Input>;

export function questionsV2Tool() {
  return tool({
    description: QUESTIONS_V2_DESCRIPTION,
    inputSchema: QuestionsV2Input,
    // Signal-only: render UI is a parallel concern (see ChatPanel +
    // QuestionsForm). The agent must end its turn after this returns.
    execute: async () => 'Questions sent. End your turn to let the user answer.',
  });
}
