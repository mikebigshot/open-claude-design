// main-loop-registry — mirror of the official Claude Design `Tb` Map (research
// v2 §10.5 + §14.2). Registers the main agent loop's snapshot getter while a
// turn is in flight, lets the `fork_verifier_agent` tool reach back to read
// fork-time state (messages, BYOK key, sendMessage), and tracks the
// per-chat `::verifier` viewport so a second concurrent fork is rejected.
//
// Two guards exactly mirror official:
//
//   Guard #1 — snapshot presence
//     If the main loop isn't currently running for `chatId`, `getMainLoopSnapshot`
//     returns null. Tool execute() returns an isError tool_result rather than
//     spawning anything. This is what kills the "reload page → effect re-spawns
//     verifier" bug we had: on mount, no main loop ⇒ no spawn possible.
//
//   Guard #2 — single-verifier-per-chat
//     `tryAcquireVerifier(viewportKey)` returns false if a verifier is already
//     running for the same `<chatId>::verifier` viewport. Prevents a second
//     fork from blowing up while the first is mid-stream.
//
// The registry is module-level (singleton). Multi-chat is handled by keying
// everything on `chatId` — different chats register independently, and the
// fork tool reads the active chat's snapshot at execute time.

import type { Fidelity, LLMProvider } from '@open-design/contracts';
import type { DesignAgentUIMessage } from './ui-messages.js';
import type { VerifierResult } from './verifier.js';

export interface MainLoopSnapshot {
  projectId: string;
  apiKey: string;
  provider: LLMProvider;
  fidelity: Fidelity;
  designSystemId?: string;
  designSystemName?: string;
  designSystemTokensCss?: string;
  /** The main agent's chat session id (used to derive `::verifier` viewport key). */
  mainSessionId: string;
  /** Live message array at fork time — verifier inherits this verbatim. */
  messages: DesignAgentUIMessage[];
  /** Called when the verifier resolves with a verdict. */
  onVerdict: (result: VerifierResult) => void;
  /** Called when spawnVerifier rejects (network / SDK error). */
  onError: (err: Error) => void;
  /** Called when spawn begins, so the UI can flip `verifier.running` to true. */
  onSpawnStart: () => void;
}

/** A getter so the fork tool sees the latest messages array — not a snapshot frozen at registration time. */
export type MainLoopSnapshotGetter = () => MainLoopSnapshot;

const mainLoops = new Map<string, MainLoopSnapshotGetter>();
const runningVerifiers = new Set<string>();

export function registerMainLoop(chatId: string, get: MainLoopSnapshotGetter): void {
  mainLoops.set(chatId, get);
}

export function unregisterMainLoop(chatId: string): void {
  mainLoops.delete(chatId);
}

export function getMainLoopSnapshot(chatId: string): MainLoopSnapshot | null {
  const get = mainLoops.get(chatId);
  return get ? get() : null;
}

/** Returns true if acquired, false if a verifier was already running for this viewport. */
export function tryAcquireVerifier(viewportKey: string): boolean {
  if (runningVerifiers.has(viewportKey)) return false;
  runningVerifiers.add(viewportKey);
  return true;
}

export function releaseVerifier(viewportKey: string): void {
  runningVerifiers.delete(viewportKey);
}

export function isVerifierRunning(viewportKey: string): boolean {
  return runningVerifiers.has(viewportKey);
}

/**
 * Test-only helper: wipe both the snapshot registry and the running-verifier
 * set. Each test that touches this module should call `beforeEach(_resetMainLoopRegistry)`
 * so leaked state from a prior case can't bleed into the next.
 */
export function _resetMainLoopRegistry(): void {
  mainLoops.clear();
  runningVerifiers.clear();
}
