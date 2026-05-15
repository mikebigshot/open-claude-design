// done-gate — module-level per-chat flag tracking whether the main agent has
// successfully called `done` in the current session.
//
// The `fork_verifier_agent` tool uses `hasDoneFired(chatId)` to refuse
// full-sweep forks before a successful `done`. Error message:
//   "Error: call `done` first to surface a working view to the user before
//    forking the verifier. (Or pass `task` for a directed mid-task check
//    that bypasses this gate.)"
//
// The `done` tool calls `markDone(chatId)` only when its console-error scan
// comes back clean.

const gate = new Set<string>();

export function markDone(chatId: string): void {
  const trimmed = chatId?.trim();
  if (!trimmed) {
    throw new Error('markDone requires a non-empty chatId');
  }
  gate.add(trimmed);
}

export function hasDoneFired(chatId: string): boolean {
  if (!chatId) return false;
  return gate.has(chatId);
}

export function clearDone(chatId: string): void {
  if (!chatId) return;
  gate.delete(chatId);
}

/** Test-only hook. Wipes all gate state. Do not use in production. */
export function _resetDoneGate(): void {
  gate.clear();
}
