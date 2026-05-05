// Lightweight global toast — single-instance, fire-and-forget API.
//
// Use case: surface fire-and-forget network failures (e.g. background PUTs
// where the optimistic UI already moved on). The toast appears bottom-center
// over the workspace, auto-dismisses after `duration` ms, and is replaced if
// a new toast is shown before the previous one expires.
//
// Why not react-hot-toast / sonner: this codebase has zero notification dep,
// and we only need a single error variant for now. Keep it ~100 LOC, no deps.
//
// Public API:
//   <ToastHost />            — mount once near the app root
//   showToast({ message })   — call from anywhere (sync, no React context)
//
// The host subscribes to a module-scope event emitter so callers don't need
// access to a React context (matches model-pref-events.ts pattern in this
// codebase). Tests can drive the host with `showToast(...)` directly.

import { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';

export type ToastVariant = 'error' | 'info';

export interface ToastOptions {
  message: string;
  /** Auto-dismiss after this many ms (default 4000). 0 = sticky. */
  duration?: number;
  variant?: ToastVariant;
  /** Stable id — if provided and matches an active toast, replaces it (no flicker). */
  id?: string;
}

interface ActiveToast extends Required<Pick<ToastOptions, 'message' | 'variant'>> {
  id: string;
  duration: number;
  // Monotonic ordinal so the host knows when to reset its dismiss timer even
  // if the same id is shown twice in quick succession.
  ordinal: number;
}

type Listener = (t: ActiveToast | null) => void;

const listeners = new Set<Listener>();
let current: ActiveToast | null = null;
let ordinalCounter = 0;

function emit(next: ActiveToast | null): void {
  current = next;
  for (const fn of listeners) fn(next);
}

/** Show a toast. Returns the resolved toast id (so callers can dismiss). */
export function showToast(opts: ToastOptions): string {
  const id = opts.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ordinalCounter += 1;
  emit({
    id,
    message: opts.message,
    variant: opts.variant ?? 'info',
    duration: opts.duration ?? 4000,
    ordinal: ordinalCounter,
  });
  return id;
}

/** Programmatic dismiss — only acts if the active toast matches `id`. */
export function dismissToast(id: string): void {
  if (current?.id === id) emit(null);
}

const slideIn = keyframes`
  from { transform: translate(-50%, 12px); opacity: 0; }
  to   { transform: translate(-50%, 0);    opacity: 1; }
`;

const Wrapper = styled.div<{ $variant: ToastVariant }>`
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 1000;
  padding: 10px 16px;
  border-radius: 10px;
  font-family: ${(p) => p.theme.fonts.sans};
  font-size: 13px;
  line-height: 1.4;
  max-width: 480px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid
    ${(p) => (p.$variant === 'error' ? p.theme.colors.danger : p.theme.colors.line200)};
  color: ${(p) => (p.$variant === 'error' ? p.theme.colors.danger : p.theme.colors.fg100)};
  animation: ${slideIn} 0.18s ease-out;
`;

/**
 * Mount once near the app root. The host listens for module-level toast events
 * and renders a single styled banner. role="status" lets screen readers
 * announce error toasts without stealing focus.
 */
export function ToastHost(): JSX.Element | null {
  const [toast, setToast] = useState<ActiveToast | null>(current);

  useEffect(() => {
    const fn: Listener = (t) => setToast(t);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!toast || toast.duration <= 0) return;
    const timer = window.setTimeout(() => {
      // Only clear if the same toast is still active (avoid clobbering a
      // newer toast that arrived between schedule + fire).
      if (current?.ordinal === toast.ordinal) emit(null);
    }, toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <Wrapper
      data-testid="toast"
      data-toast-variant={toast.variant}
      role={toast.variant === 'error' ? 'alert' : 'status'}
      $variant={toast.variant}
    >
      {toast.message}
    </Wrapper>
  );
}

/**
 * Test helper — clears any active toast and resets the ordinal counter so
 * test cases don't bleed into each other. Not exported from index.ts; pulled
 * directly when needed.
 */
export function resetToastsForTest(): void {
  current = null;
  ordinalCounter = 0;
  for (const fn of listeners) fn(null);
}
