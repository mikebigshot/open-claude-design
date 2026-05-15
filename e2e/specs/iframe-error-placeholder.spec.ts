// iframe-error-placeholder e2e — in-iframe error UI for malformed artifacts.
//
// Bug repro (verbatim from internal report): a project whose `App.jsx` has a
// JS syntax error (e.g. nested ASCII double-quotes inside a string literal)
// makes Babel throw during the inline transform, and the preview iframe
// renders completely blank. The host already gets the `IFRAME_ERROR`
// postMessage and `console.warn`s it, but nothing surfaces in the visible
// iframe area, so the user sees only the cream-colored panel.
//
// Fix: the iframe srcdoc now carries an inline error handler (registered
// before Babel processes inline scripts) that paints a placeholder with the
// error name, message, and offending line excerpt inside the iframe itself.
// Quality bar from the repo's CLAUDE.md: external boundaries (iframe being
// one) must have an explicit error-state UI; this spec is the e2e half of
// that contract.
//
// Test shape:
//   1. Create a project via the worker API directly (no chat round-trip — we
//      want full control over the file content so we can stuff a known-bad
//      JSX in there).
//   2. PUT a bad `App.jsx` whose contents contain nested ASCII double-quotes
//      that Babel rejects with "Unexpected token, expected ','".
//   3. Navigate to `/p/:id`, wait for the preview iframe to mount.
//   4. Inside the iframe, assert the `[data-codesign-iframe-error]`
//      placeholder is visible AND contains the error name + message.
//   5. Confirm the parent still received the `IFRAME_ERROR` postMessage
//      (overlay behavior preserved). We sniff this via `console.warn`
//      capture — PreviewPanel's existing handler logs `[preview] iframe
//      error: ...` on receipt.

import { expect, test, type Page } from '../fixtures/test-with-tracker';
import { injectByok } from '../fixtures/byok';

// Verbatim shape from the bug report — nested ASCII double-quotes in a JSX
// string literal. Babel rejects this on parse before any code runs.
const BAD_APP_JSX = [
  'function App() {',
  '  const messages = [',
  '    { delay: 1000, text: "first" },',
  '    { delay: 7300, text: "  [PENDING]  把"能跑就行"..." },',
  '  ];',
  '  return <div>{messages[0].text}</div>;',
  '}',
].join('\n');

const API_BASE = process.env.E2E_API_PORT
  ? `http://localhost:${process.env.E2E_API_PORT}`
  : 'http://localhost:8787';

interface ProjectCreateResponse {
  id: string;
}

/**
 * Create a project + write a known-bad `App.jsx` to it via the worker API.
 * Returns the project id (for navigating to `/p/:id`).
 *
 * IMPORTANT: the worker uses a SHARED D1 database across e2e tests. A
 * project with bad JSX that lingers in the DB will surface in OTHER tests'
 * Home page — `ProjectThumb` mounts a preview iframe for every project,
 * and the bad iframe's Babel SyntaxError counts as a page error against
 * the unrelated test, breaking it. Caller MUST clean up via
 * `deleteProject` (registered via `test.afterEach` below).
 */
async function createProjectWithBadArtifact(page: Page): Promise<string> {
  const projectResp = await page.request.post(`${API_BASE}/api/projects`, {
    data: {
      name: `e2e bad-artifact ${Date.now()}`,
      type: 'prototype',
      fidelity: 'high',
    },
    headers: { 'content-type': 'application/json' },
  });
  expect(projectResp.status()).toBe(201);
  const project = (await projectResp.json()) as ProjectCreateResponse;

  // PUT the bad JSX directly — content-type JSON, the worker stores it as text/jsx.
  const fileResp = await page.request.put(
    `${API_BASE}/api/projects/${project.id}/files/App.jsx`,
    {
      data: { content: BAD_APP_JSX, mimeType: 'text/jsx' },
      headers: { 'content-type': 'application/json' },
    },
  );
  expect(fileResp.status()).toBe(200);

  return project.id;
}

async function deleteProject(page: Page, projectId: string): Promise<void> {
  try {
    await page.request.delete(`${API_BASE}/api/projects/${projectId}`);
  } catch {
    // Best-effort: if delete fails, the test cleanup hook can't do anything
    // useful, and the leftover project will pollute later runs.
  }
}

test.describe('iframe error placeholder', () => {
  // Per-test cleanup state: each `test.beforeEach` resets, each `test` pushes
  // its created project id, `afterEach` deletes them so the bad-JSX artifacts
  // don't linger in the shared worker D1 DB. Without this, the next test's
  // Home page would render `ProjectThumb` for these bad projects → the
  // hidden thumbnail iframes' Babel SyntaxError pageerror would fail
  // unrelated tests.
  const createdProjects: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdProjects.length = 0;
    await injectByok(page);
  });

  test.afterEach(async ({ page }) => {
    for (const id of createdProjects) {
      await deleteProject(page, id);
    }
    createdProjects.length = 0;
  });

  async function createAndTrack(page: Page): Promise<string> {
    const id = await createProjectWithBadArtifact(page);
    createdProjects.push(id);
    return id;
  }

  test('bad JSX renders the in-iframe error placeholder, not a blank panel', async ({
    page,
    errorTracker,
  }) => {
    // The bad artifact deliberately throws inside the iframe. Babel
    // Standalone surfaces the SyntaxError up the iframe → host pageerror
    // boundary, AND PreviewPanel logs `[preview] iframe error: ...` on
    // receipt of the IFRAME_ERROR postMessage. Both are expected for this
    // case, not test failure signals.
    errorTracker.acknowledge({
      page: [{ pageErrorPattern: /SyntaxError|Unexpected token|Inline Babel script/i }],
      console: [
        { consoleTextPattern: /\[preview\] iframe error/i },
        { consoleTextPattern: /Inline Babel script|SyntaxError/i },
      ],
    });

    const projectId = await createAndTrack(page);
    await page.goto(`/p/${projectId}`);

    // Wait for the preview iframe to mount. The Workspace shell auto-selects
    // the Preview tab when a JSX artifact is present.
    const iframe = page.locator('iframe[title="Preview"]');
    await expect(iframe).toBeVisible({ timeout: 15_000 });

    // Read into the iframe via frameLocator. The placeholder is appended
    // to body once Babel throws and the error handler paints.
    const frame = page.frameLocator('iframe[title="Preview"]');
    const placeholder = frame.locator('[data-codesign-iframe-error]');
    await expect(placeholder).toBeVisible({ timeout: 15_000 });

    // Role + aria attributes for accessibility.
    await expect(placeholder).toHaveAttribute('role', 'alert');
    await expect(placeholder).toHaveAttribute('aria-live', 'assertive');

    // Error name / message are surfaced.
    const errorName = placeholder.locator('[data-codesign-error-name]');
    await expect(errorName).toBeVisible();
    await expect(errorName).toHaveText(/SyntaxError|Error/);

    const errorMessage = placeholder.locator('[data-codesign-error-message]');
    await expect(errorMessage).toBeVisible();
    // Babel's actual error message contains "Unexpected token" for this
    // input. We accept either the literal phrase or the embedded (line:col)
    // coord — the placeholder must show one or the other.
    await expect(errorMessage).toContainText(/Unexpected token|\(\d+:\d+\)/);

    // The source excerpt should include the bug-report literal `[PENDING]`
    // (since that's the offending line we stuffed in).
    const excerptLine = placeholder.locator('[data-codesign-error-line]');
    await expect(excerptLine).toBeVisible();
    await expect(excerptLine).toContainText('[PENDING]');

    // Caret marker for the column points at the offending position.
    const caret = placeholder.locator('[data-codesign-error-caret]');
    await expect(caret).toBeVisible();
    await expect(caret).toContainText('^');
  });

  test('IFRAME_ERROR postMessage still flows to the host (overlay behavior preserved)', async ({
    page,
    errorTracker,
  }) => {
    // PreviewPanel's bridge.on('IFRAME_ERROR') handler console.warns the
    // message — assert that warning fired, confirming the postMessage path
    // was NOT removed by the placeholder feature.
    errorTracker.acknowledge({
      page: [{ pageErrorPattern: /SyntaxError|Unexpected token|Inline Babel script/i }],
      console: [
        { consoleTextPattern: /\[preview\] iframe error/i },
        { consoleTextPattern: /Inline Babel script|SyntaxError/i },
      ],
    });

    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'warn') {
        warnings.push(msg.text());
      }
    });

    const projectId = await createAndTrack(page);
    await page.goto(`/p/${projectId}`);

    // Wait for the iframe + placeholder so we know the error has fired
    // (otherwise the warning check could race the page load).
    const frame = page.frameLocator('iframe[title="Preview"]');
    await expect(frame.locator('[data-codesign-iframe-error]')).toBeVisible({ timeout: 15_000 });

    // Give the bridge a moment to forward the postMessage to PreviewPanel's
    // handler (it's synchronous but Playwright sometimes captures the host
    // page's console after a microtask).
    await expect
      .poll(() => warnings.find((w) => /\[preview\] iframe error/i.test(w)) ?? null, {
        timeout: 5_000,
      })
      .not.toBeNull();
  });
});
