// Toast — module-scope event emitter + single-instance host.
//
// We test:
//   1. showToast → ToastHost renders the message
//   2. error variant uses role="alert" (a11y signal)
//   3. duration → auto-dismiss
//   4. id collision → newer toast replaces older without flicker
//   5. resetToastsForTest clears state

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { ToastHost, showToast, dismissToast, resetToastsForTest } from './Toast';

function mount() {
  return render(
    <ThemeProvider theme={theme}>
      <ToastHost />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  resetToastsForTest();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('does not render anything when no toast is active', () => {
    mount();
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('renders the message after showToast', () => {
    mount();
    act(() => {
      showToast({ message: 'hello' });
    });
    expect(screen.getByTestId('toast').textContent).toBe('hello');
  });

  it('error variant uses role="alert" for screen readers', () => {
    mount();
    act(() => {
      showToast({ message: 'kaboom', variant: 'error' });
    });
    const node = screen.getByTestId('toast');
    expect(node).toHaveAttribute('role', 'alert');
    expect(node).toHaveAttribute('data-toast-variant', 'error');
  });

  it('info variant uses role="status"', () => {
    mount();
    act(() => {
      showToast({ message: 'hi', variant: 'info' });
    });
    const node = screen.getByTestId('toast');
    expect(node).toHaveAttribute('role', 'status');
  });

  it('auto-dismisses after the specified duration', () => {
    vi.useFakeTimers();
    mount();
    act(() => {
      showToast({ message: 'transient', duration: 100 });
    });
    expect(screen.getByTestId('toast')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(101);
    });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('duration: 0 means sticky (no auto-dismiss)', () => {
    vi.useFakeTimers();
    mount();
    act(() => {
      showToast({ message: 'sticky', duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('toast')).toBeInTheDocument();
  });

  it('repeating the same id replaces the previous toast (no flicker)', () => {
    mount();
    act(() => {
      showToast({ id: 'persist-error', message: 'first' });
    });
    expect(screen.getByTestId('toast').textContent).toBe('first');
    act(() => {
      showToast({ id: 'persist-error', message: 'second' });
    });
    expect(screen.getByTestId('toast').textContent).toBe('second');
    // Single host instance — only one toast at a time.
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
  });

  it('dismissToast hides only the matching id', () => {
    mount();
    let id: string = '';
    act(() => {
      id = showToast({ id: 'a', message: 'gone' });
    });
    expect(screen.getByTestId('toast')).toBeInTheDocument();
    act(() => dismissToast(id));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('dismissToast with a stale id is a no-op', () => {
    mount();
    act(() => {
      showToast({ id: 'current', message: 'still here' });
    });
    act(() => dismissToast('different-id'));
    expect(screen.getByTestId('toast').textContent).toBe('still here');
  });
});
