// ExamplesTab — gallery interaction tests.
//
// Covers the two 2026-05-04 user-reported bugs:
//   1) "Use this prompt" must POST a project, write the prompt to
//      sessionStorage under the new `seed-composer` key (NOT auto-send),
//      and navigate to /p/<id>. Workspace mount drain is responsible for
//      the rest of the pipeline (covered separately in workspace tests).
//   2) Hover-to-activate (v2 — height-stable): box stays at a fixed 480px;
//      hover only flips iframe `pointer-events` from none → auto so wheel
//      and click events reach the demo. ExamplesTab guarantees mutual
//      exclusion — at most one active at a time. Mouse leave debounces
//      150ms. v1 grew the box on hover; reverted because the layout shift
//      was distracting.
//
// We deliberately don't test the browser-level scroll behavior of the
// iframe (jsdom can't render iframe content); that's covered in the e2e
// suite. Here we pin the *style state* + *interaction logic*.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { MemoryRouter } from 'react-router-dom';

import { theme } from '@/theme/theme';

// ── api mock — must be hoisted before ExamplesTab import ──
const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error {
    public readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

// ── react-router-dom navigate mock so we can assert the post-create URL ──
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { ExamplesTab } from './ExamplesTab';
import { EXAMPLES } from './examples-data';

function mount(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <ExamplesTab />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  navigateMock.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ExamplesTab — render', () => {
  it('renders one card per EXAMPLES entry', () => {
    mount();
    for (const entry of EXAMPLES) {
      expect(screen.getByText(entry.title)).toBeInTheDocument();
    }
  });

  it('renders the intro banner with the new "review and submit" wording', () => {
    mount();
    // The intro must reflect that the prompt is pre-filled (not auto-sent).
    // If someone re-introduces auto-send wording, this guard will catch it.
    const intro = screen.getByText(/spin up a new project with the prompt/i);
    expect(intro).toBeInTheDocument();
    expect(intro.textContent).toMatch(/pre-filled/i);
  });

  it('every preview defaults to inactive (data-active=false, hover hint visible)', () => {
    mount();
    for (const entry of EXAMPLES) {
      const box = screen.getByTestId(`example-preview-${entry.slug}`);
      expect(box.getAttribute('data-active')).toBe('false');
    }
    // Every card has a hover hint when inactive.
    expect(screen.getAllByText(/HOVER TO INTERACT/).length).toBe(EXAMPLES.length);
  });
});

describe('ExamplesTab — hover-to-activate', () => {
  it('mouseenter on a preview activates it (data-active=true)', () => {
    mount();
    const first = EXAMPLES[0]!;
    const box = screen.getByTestId(`example-preview-${first.slug}`);
    expect(box.getAttribute('data-active')).toBe('false');

    act(() => fireEvent.mouseEnter(box));
    expect(box.getAttribute('data-active')).toBe('true');
  });

  it('hides the HOVER TO INTERACT hint while active', () => {
    mount();
    const first = EXAMPLES[0]!;
    const box = screen.getByTestId(`example-preview-${first.slug}`);
    // Inactive: every card shows the hint.
    expect(screen.getAllByText(/HOVER TO INTERACT/).length).toBe(EXAMPLES.length);

    act(() => fireEvent.mouseEnter(box));
    // Active card hides its hint; siblings still show it.
    expect(screen.queryAllByText(/HOVER TO INTERACT/).length).toBe(EXAMPLES.length - 1);
  });

  it('mutual exclusion: hovering a second card deactivates the first immediately', () => {
    mount();
    const first = EXAMPLES[0]!;
    const second = EXAMPLES[1]!;
    const boxA = screen.getByTestId(`example-preview-${first.slug}`);
    const boxB = screen.getByTestId(`example-preview-${second.slug}`);

    act(() => fireEvent.mouseEnter(boxA));
    expect(boxA.getAttribute('data-active')).toBe('true');
    expect(boxB.getAttribute('data-active')).toBe('false');

    act(() => fireEvent.mouseEnter(boxB));
    // B activation cancels A's leave debounce (if any) AND switches active.
    expect(boxA.getAttribute('data-active')).toBe('false');
    expect(boxB.getAttribute('data-active')).toBe('true');
  });

  it('mouseleave deactivates after 150ms debounce', () => {
    vi.useFakeTimers();
    mount();
    const first = EXAMPLES[0]!;
    const box = screen.getByTestId(`example-preview-${first.slug}`);
    act(() => fireEvent.mouseEnter(box));
    expect(box.getAttribute('data-active')).toBe('true');

    act(() => fireEvent.mouseLeave(box));
    // Still active immediately after mouseleave.
    expect(box.getAttribute('data-active')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(box.getAttribute('data-active')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(box.getAttribute('data-active')).toBe('false');

    vi.useRealTimers();
  });

  it('mouseenter during the leave debounce cancels the deactivation', () => {
    vi.useFakeTimers();
    mount();
    const first = EXAMPLES[0]!;
    const box = screen.getByTestId(`example-preview-${first.slug}`);

    act(() => fireEvent.mouseEnter(box));
    act(() => fireEvent.mouseLeave(box));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Re-enter before the timer fires — should stay active.
    act(() => fireEvent.mouseEnter(box));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(box.getAttribute('data-active')).toBe('true');

    vi.useRealTimers();
  });

  it('focus also activates the preview (a11y keyboard path)', () => {
    mount();
    const first = EXAMPLES[0]!;
    const box = screen.getByTestId(`example-preview-${first.slug}`);
    act(() => fireEvent.focus(box));
    expect(box.getAttribute('data-active')).toBe('true');
  });
});

describe('ExamplesTab — Use this prompt', () => {
  it('POSTs /api/projects, writes seed-composer to sessionStorage, navigates to /p/:id', async () => {
    apiMock.mockResolvedValueOnce({
      id: 'proj-new-1',
      name: 'Counter',
      type: 'react',
      fidelity: 'high',
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
    });

    mount();
    // Click the first card's "Use this prompt"
    const buttons = screen.getAllByRole('button', { name: /Use this prompt/i });
    expect(buttons.length).toBe(EXAMPLES.length);

    await act(async () => {
      fireEvent.click(buttons[0]!);
    });

    // POST issued with project metadata derived from EXAMPLES[0]
    const first = EXAMPLES[0]!;
    expect(apiMock).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({ method: 'POST' }),
    );

    // sessionStorage updated under the NEW key (composerSeed semantics)
    expect(window.sessionStorage.getItem('open-design:seed-composer:proj-new-1')).toBe(
      first.prompt,
    );

    // Legacy key must NOT be set — guard against accidental dual-write that
    // would re-introduce the BYOK race via the auto-send drain path.
    expect(window.sessionStorage.getItem('open-design:seed-prompt:proj-new-1')).toBeNull();

    // Navigated to the new project workspace.
    expect(navigateMock).toHaveBeenCalledWith('/p/proj-new-1');
  });

  it('shows error text when POST /api/projects fails', async () => {
    apiMock.mockRejectedValueOnce(new Error('quota exceeded'));

    mount();
    const buttons = screen.getAllByRole('button', { name: /Use this prompt/i });

    await act(async () => {
      fireEvent.click(buttons[0]!);
    });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('quota exceeded');
  });

  it('disables the button DURING create and re-enables once the request settles', async () => {
    // Hand-rolled deferred so we can observe the in-flight state before settling.
    let rejectFn: (err: Error) => void = () => {};
    apiMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFn = reject;
        }),
    );

    mount();
    const buttons = screen.getAllByRole('button', { name: /Use this prompt/i });
    const firstBtn = buttons[0]! as HTMLButtonElement;

    act(() => {
      fireEvent.click(firstBtn);
    });

    // While the promise is pending the button must be disabled and read "Creating…"
    expect(firstBtn.disabled).toBe(true);
    expect(firstBtn.textContent).toMatch(/Creating/);

    // Settle with rejection — button must re-enable + error renders.
    await act(async () => {
      rejectFn(new Error('quota exceeded'));
    });

    expect(firstBtn.disabled).toBe(false);
    expect(firstBtn.textContent).toMatch(/Use this prompt/);
    expect(screen.getByRole('alert').textContent).toContain('quota exceeded');
  });
});
