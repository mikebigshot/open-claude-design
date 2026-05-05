// Examples gallery e2e cases.
//
// Covers user-reported bugs:
//   1. Click "Use this prompt" must reliably pre-fill the chat composer.
//      Previously the auto-send drain swallowed messages when no BYOK key
//      was set + KeyModal cancel. Now it's draft pre-fill only, so the
//      no-key path also works.
//   2. Hover-to-activate the preview iframe so users can scroll + interact
//      with the demo. ExamplesTab guarantees mutual exclusion.
//
// Each case is automated:true — production-grade quality bar (no fixme
// stubs allowed).

import type { CaseEntry } from './index';

export const examplesFlowCases: CaseEntry[] = [
  {
    id: 'examples-tab-renders-all-cards',
    name: 'EX-1: Examples tab on Home renders one card per static example',
    automated: true,
    notes:
      'Smoke: home → Examples tab → 4 cards (counter / todo / landing-page / dashboard) visible. ' +
      'Pins the static EXAMPLES list shape; will need updating if we add/remove examples.',
  },
  {
    id: 'examples-use-prompt-prefills-composer-with-key',
    name: 'EX-2: Click "Use this prompt" with BYOK key → workspace + composer prefilled (not auto-sent)',
    automated: true,
    notes:
      'Click → POST /api/projects → navigate /p/:id → composer textarea contains entry.prompt. ' +
      'CRITICAL: must NOT auto-send (no chat-msg-user-* in history). User reviews then submits.',
  },
  {
    id: 'examples-use-prompt-prefills-composer-without-key',
    name: 'EX-3: Click "Use this prompt" without BYOK key → still prefills composer, no modal',
    automated: true,
    notes:
      'Bug 1 regression guard: clear localStorage → click → composer prefilled, no KeyModal pops. ' +
      'Modal only appears when user actually clicks Send. Prevents the silent-message-loss bug.',
  },
  {
    id: 'examples-hover-activates-preview',
    name: 'EX-4: Hover preview → iframe pointer-events flips to auto, box height stable',
    automated: true,
    notes:
      'Inactive: data-active=false, iframe pointer-events=none, box height 480px. ' +
      'Hover: data-active=true, iframe pointer-events=auto, box height STILL 480px. ' +
      'v2: dropped the height-grows-on-hover behavior in favor of a stable box.',
  },
  {
    id: 'examples-mutual-exclusion-on-hover',
    name: 'EX-5: Hovering a second preview deactivates the first (mutual exclusion)',
    automated: true,
    notes:
      'Hover preview A → A active. Hover preview B → A inactive immediately, B active. ' +
      'Guards the user-spec "同一时刻只能有一个 example 被 hover 动态起来".',
  },
];

export function automatedExamplesFlowCases(): CaseEntry[] {
  return examplesFlowCases.filter((c) => c.automated);
}
