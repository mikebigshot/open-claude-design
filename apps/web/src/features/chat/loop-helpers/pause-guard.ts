// pause-guard — counter for §2.5 pause_turn handling.
//
// AI SDK v6 may not directly surface the `pause_turn` stop_reason that
// Anthropic emits during multi-step server-side tools (web_search /
// web_fetch hosted-tool variants). When we wire pause_turn detection in,
// this counter lives between turns and bumps on each retry; once budget is
// exhausted, the loop should bail with an error rather than infinite-loop.
//
// We only ship CLIENT-side web_fetch today, so pause_turn isn't currently
// triggerable in our path. This helper is here for forward-compat: when we
// add server-tools, the wire-up is just `if (guard.tick()) bail()`.

export interface PauseGuard {
  readonly max: number;
  readonly count: number;
  /** Increments the count. Returns true when count > max (over budget). */
  tick(): boolean;
  reset(): void;
}

const DEFAULT_MAX = 3;

export function makePauseGuard(opts: { max?: number } = {}): PauseGuard {
  const max = opts.max ?? DEFAULT_MAX;
  let count = 0;
  return {
    max,
    get count() {
      return count;
    },
    tick(): boolean {
      count += 1;
      return count > max;
    },
    reset(): void {
      count = 0;
    },
  };
}
