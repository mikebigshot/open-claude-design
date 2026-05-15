// Deck/PPT alignment e2e — verifies the new skills + new tools that landed
// in research/claude-design-v2 §13 Steps A-H by exercising the real UI:
//   - SkillPicker renders 9 visible skills (was 4)
//   - The 4 new tools (open_for_print / present_fs_item_for_download /
//     gen_pptx / super_inline_html) render their verb chips with the right
//     verb word + target when the agent fires them
//
// Driven by Playwright against Chrome for Testing (bundled with @playwright).
// OpenRouter is mocked via the shared fixture; BYOK key is injected up front.

import { test, expect, type Page } from '@playwright/test';
import { injectByok } from '../fixtures/byok';
import { mockOpenRouter, type MockTurn } from '../fixtures/openrouter-mock';

test.describe('deck/ppt alignment — skills + tool verb chips', () => {
  // Serial within the describe — both tests POST /api/projects against the
  // shared wrangler D1 state; running them in parallel under load racey the
  // create-project flow. Each test is fast (~2-3s) so serial cost is small.
  test.describe.configure({ mode: 'serial' });
  test('SkillPicker shows all 9 v2-aligned skills including Make a deck + PPTX variants', async ({
    page,
  }) => {
    await injectByok(page);
    // No turns needed; we don't send a message in this test.
    await mockOpenRouter(page, { turns: [] });

    await openProjectComposer(page);

    // Open Add context → Attach skill
    await page.getByRole('button', { name: /Add context/i }).click();
    await page.getByRole('menuitem', { name: /Attach skill/i }).click();

    // Menu opens — assert each of the 9 SKILL frontmatter.name strings
    // appears as a clickable item.
    const menu = page.getByRole('menu', { name: /skill picker/i });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    const expectedSkills = [
      'Make a deck',
      'Interactive prototype',
      'Wireframe',
      'Frontend design',
      'Make tweakable',
      'Save as standalone HTML',
      'Save as PDF',
      'Export as PPTX (editable)',
      'Export as PPTX (screenshots)',
    ];
    for (const name of expectedSkills) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible();
    }
    // Sanity: exactly 9 menuitems, not 4
    const items = await menu.getByRole('menuitem').all();
    expect(items.length).toBe(expectedSkills.length);
  });

  test('tool verb chips render for open_for_print / present_fs_item_for_download / gen_pptx / super_inline_html', async ({
    page,
  }) => {
    await injectByok(page);
    // Each turn ends with stop so the agent loop terminates (we just want
    // to render the chips, not actually export anything). Tool execute
    // results aren't important — only the verb-chip rendering is.
    const turns: MockTurn[] = [
      {
        text: '',
        toolCalls: [
          {
            name: 'open_for_print',
            args: { project_relative_file_path: 'deck/index.html' },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'present_fs_item_for_download',
            args: { path: 'deck/', label: 'My Deck' },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'gen_pptx',
            args: {
              mode: 'editable',
              slides: [{ title: 'Hi' }],
              outputFilename: 'Demo.pptx',
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'super_inline_html',
            args: { input_path: 'index.html', output_path: 'bundle.html' },
          },
        ],
        finishReason: 'tool_calls',
      },
      // Closing turn so the loop ends cleanly.
      { text: 'All set.', finishReason: 'stop' },
    ];
    await mockOpenRouter(page, { turns });

    await openProjectComposer(page);

    const composer = page.getByRole('textbox', { name: /chat composer/i });
    await composer.fill('export everything please');
    // Under parallel load the Send button can stay disabled for a few seconds
    // while the chat panel finishes hydrating. Wait for enabled.
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeEnabled({ timeout: 20_000 });
    await send.click();

    // The chips render inside MonoFramedBlock with verb text from i18n.
    // English defaults: opening = OPEN, downloading = DOWN, exporting =
    // EXPORT, bundling = BUNDLE.
    await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('DOWN', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('EXPORT', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('BUNDLE', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Targets — verb chip "target" column carries the file path / label.
    await expect(page.getByText('deck/index.html')).toBeVisible();
    await expect(page.getByText('My Deck')).toBeVisible();
    await expect(page.getByText('Demo.pptx')).toBeVisible();
    await expect(page.getByText('bundle.html')).toBeVisible();
  });
});

async function openProjectComposer(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(`E2E deck/ppt ${Date.now()}`);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 15_000 });
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible({ timeout: 15_000 });
}
