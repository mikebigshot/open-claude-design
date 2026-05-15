import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerMainLoop,
  unregisterMainLoop,
  getMainLoopSnapshot,
  tryAcquireVerifier,
  releaseVerifier,
  isVerifierRunning,
  _resetMainLoopRegistry,
  type MainLoopSnapshot,
} from '../main-loop-registry.js';

function snapshot(overrides: Partial<MainLoopSnapshot> = {}): MainLoopSnapshot {
  return {
    projectId: 'p1',
    apiKey: 'sk-test',
    provider: 'openrouter',
    fidelity: 'high',
    designSystemId: 'none',
    designSystemName: undefined,
    designSystemTokensCss: undefined,
    mainSessionId: 'main-session-1',
    messages: [],
    onVerdict: () => {},
    onError: () => {},
    onSpawnStart: () => {},
    ...overrides,
  };
}

describe('main-loop-registry', () => {
  beforeEach(() => {
    _resetMainLoopRegistry();
  });

  describe('snapshot register / get / unregister', () => {
    it('returns null when no main loop has registered for the chatId', () => {
      expect(getMainLoopSnapshot('chat-A')).toBeNull();
    });

    it('returns the snapshot via getter when registered', () => {
      const snap = snapshot({ apiKey: 'sk-A' });
      registerMainLoop('chat-A', () => snap);
      expect(getMainLoopSnapshot('chat-A')).toBe(snap);
    });

    it('returns null after unregister', () => {
      registerMainLoop('chat-A', () => snapshot());
      unregisterMainLoop('chat-A');
      expect(getMainLoopSnapshot('chat-A')).toBeNull();
    });

    it('returns a fresh snapshot each call (getter is invoked each time)', () => {
      const messagesRef: { current: string[] } = { current: ['m0'] };
      registerMainLoop(
        'chat-A',
        () => snapshot({ messages: messagesRef.current as never }),
      );
      const first = getMainLoopSnapshot('chat-A');
      messagesRef.current = ['m0', 'm1'];
      const second = getMainLoopSnapshot('chat-A');
      expect((first?.messages as unknown as string[]).length).toBe(1);
      expect((second?.messages as unknown as string[]).length).toBe(2);
    });

    it('isolates registrations per chatId', () => {
      const snapA = snapshot({ apiKey: 'sk-A' });
      const snapB = snapshot({ apiKey: 'sk-B' });
      registerMainLoop('chat-A', () => snapA);
      registerMainLoop('chat-B', () => snapB);
      expect(getMainLoopSnapshot('chat-A')?.apiKey).toBe('sk-A');
      expect(getMainLoopSnapshot('chat-B')?.apiKey).toBe('sk-B');
      unregisterMainLoop('chat-A');
      expect(getMainLoopSnapshot('chat-A')).toBeNull();
      expect(getMainLoopSnapshot('chat-B')?.apiKey).toBe('sk-B');
    });

    it('lets a re-register replace the prior getter', () => {
      registerMainLoop('chat-A', () => snapshot({ apiKey: 'sk-V1' }));
      registerMainLoop('chat-A', () => snapshot({ apiKey: 'sk-V2' }));
      expect(getMainLoopSnapshot('chat-A')?.apiKey).toBe('sk-V2');
    });
  });

  describe('verifier acquire / release', () => {
    it('first acquire returns true', () => {
      expect(tryAcquireVerifier('chat-A::verifier')).toBe(true);
    });

    it('second acquire while still held returns false', () => {
      expect(tryAcquireVerifier('chat-A::verifier')).toBe(true);
      expect(tryAcquireVerifier('chat-A::verifier')).toBe(false);
    });

    it('after release, re-acquire returns true', () => {
      tryAcquireVerifier('chat-A::verifier');
      releaseVerifier('chat-A::verifier');
      expect(tryAcquireVerifier('chat-A::verifier')).toBe(true);
    });

    it('isVerifierRunning reflects acquire / release', () => {
      expect(isVerifierRunning('chat-A::verifier')).toBe(false);
      tryAcquireVerifier('chat-A::verifier');
      expect(isVerifierRunning('chat-A::verifier')).toBe(true);
      releaseVerifier('chat-A::verifier');
      expect(isVerifierRunning('chat-A::verifier')).toBe(false);
    });

    it('acquire keys are isolated per viewport', () => {
      tryAcquireVerifier('chat-A::verifier');
      expect(tryAcquireVerifier('chat-B::verifier')).toBe(true);
    });

    it('release is idempotent (safe to call without a prior acquire)', () => {
      expect(() => releaseVerifier('chat-A::verifier')).not.toThrow();
      expect(isVerifierRunning('chat-A::verifier')).toBe(false);
    });
  });

  describe('_resetMainLoopRegistry', () => {
    it('clears both maps so tests are independent', () => {
      registerMainLoop('chat-A', () => snapshot());
      tryAcquireVerifier('chat-A::verifier');
      _resetMainLoopRegistry();
      expect(getMainLoopSnapshot('chat-A')).toBeNull();
      expect(isVerifierRunning('chat-A::verifier')).toBe(false);
    });
  });
});
