// makeMultiplayerSuffix — §2.9 helper.
//
// Build the trailing "# Multiplayer session" block of the system prompt's
// dynamic suffix. Verbatim wording matched against v2's
// main-agent-loop-full.raw.js so the model's behavior under multiplayer
// matches our spec.
//
// W3 owns system-prompt/index.ts and will call this during merge to
// thread the suffix into block-2 (`buildBlock2`'s output gets `+suffix`).

/**
 * @param participants Map keyed by stable participant id (account uuid),
 * value is the display name shown to the model.
 */
export function makeMultiplayerSuffix(participants: Map<string, string>): string {
  if (participants.size === 0) return '';
  // Dedup by display name — same human in two tabs / two windows shouldn't
  // count twice.
  const uniqueNames = [...new Set(participants.values())];
  if (uniqueNames.length < 2) return '';
  const names = uniqueNames.join(', ');
  return `

# Multiplayer session

This conversation has multiple human participants (${names}). User messages may be prefixed with the author's name in square brackets where the author is known. Treat each person's requests distinctly and address them by name where it helps.`;
}
