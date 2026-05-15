// Verifier sub-agent e2e — fork_verifier_agent dispatches a verifier
// sub-Chat under `<main session id>::verifier`. The verifier inherits the
// main transcript, calls verifier-only tools (screenshot / eval_js /
// get_webview_logs / multi_screenshot), then terminates with
// verification_feedback. This spec exercises the fork → verdict pipeline
// end to end against Chrome for Testing, with OpenRouter mocked.
//
// The mock distinguishes main vs verifier requests via the FORK_BOUNDARY
// marker in the verifier's triggering user message, so each side can be
// scripted independently.

import { test, expect, type Page } from '@playwright/test';
import { injectByok } from '../fixtures/byok';
import { mockOpenRouter, type MockTurn } from '../fixtures/openrouter-mock';

test.describe('verifier-fork — main → fork → verifier → verdict', () => {
  test.describe.configure({ mode: 'serial' });

  test('main agent firing fork_verifier_agent dispatches a verifier sub-chat that emits verification_feedback', async ({
    page,
  }) => {
    await injectByok(page);

    const mainTurns: MockTurn[] = [
      {
        text: "I'll wrap this up.",
        toolCalls: [{ name: 'done', args: { summary: 'Done with main work.' } }],
        finishReason: 'tool_calls',
      },
      {
        text: 'Now forking the verifier.',
        toolCalls: [
          {
            name: 'fork_verifier_agent',
            args: {
              task: 'Please verify the deck renders without console errors.',
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      { text: 'Thanks, all confirmed.', finishReason: 'stop' },
    ];
    const verifierTurns: MockTurn[] = [
      {
        text: 'Verifier inspecting.',
        toolCalls: [
          {
            name: 'verification_feedback',
            args: {
              verdict: 'done',
              description: 'Verified: deck renders fine, no errors.',
            },
          },
        ],
        finishReason: 'tool_calls',
      },
    ];

    await mockOpenRouter(page, { turns: mainTurns, verifierTurns });

    await openProjectAndSend(page, 'E2E verifier ok', 'Please build it and verify.');

    // Main agent emits DONE chip
    await expect(page.getByText('DONE', { exact: true })).toBeVisible({ timeout: 30_000 });
    // Then the fork_verifier_agent chip ("VERIFY")
    await expect(page.getByText('VERIFY', { exact: true })).toBeVisible({ timeout: 30_000 });
    // The verifier's verdict comes back into the main thread as a user-role
    // message formatted by formatVerdictForMain — "Verifier verdict: **done**".
    await expect(page.getByText(/Verifier verdict.*done/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Verified: deck renders fine/i)).toBeVisible();
  });

  test('verifier needs_work verdict surfaces as a user-visible needs_work message', async ({
    page,
  }) => {
    await injectByok(page);
    const mainTurns: MockTurn[] = [
      {
        text: '',
        toolCalls: [{ name: 'done', args: { summary: 'finished' } }],
        finishReason: 'tool_calls',
      },
      {
        text: '',
        toolCalls: [{ name: 'fork_verifier_agent', args: {} }],
        finishReason: 'tool_calls',
      },
      { text: "I'll fix slide 3.", finishReason: 'stop' },
    ];
    const verifierTurns: MockTurn[] = [
      {
        text: '',
        toolCalls: [
          {
            name: 'verification_feedback',
            args: {
              verdict: 'needs_work',
              description: 'Slide 3 has a contrast issue.',
            },
          },
        ],
        finishReason: 'tool_calls',
      },
    ];
    await mockOpenRouter(page, { turns: mainTurns, verifierTurns });

    await openProjectAndSend(page, 'E2E verifier needs-work', 'do it');

    await expect(page.getByText(/Verifier verdict.*needs_work/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/Slide 3 has a contrast issue/i)).toBeVisible();
  });
});

async function openProjectAndSend(page: Page, prefix: string, prompt: string): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(`${prefix} ${Date.now()}`);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 15_000 });
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill(prompt);
  // Under parallel load the Send button can stay disabled for a few seconds
  // while the chat panel finishes hydrating. Wait for enabled before click
  // — locator.click() defaults to a 30s wait but the matching assertion
  // makes the intent explicit and surfaces clean failure if it never enables.
  const send = page.getByRole('button', { name: /^send$/i });
  await expect(send).toBeEnabled({ timeout: 20_000 });
  await send.click();
}
