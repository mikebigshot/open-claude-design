import { describe, expect, it } from 'vitest';
import { ALLOWED_FILE_MIME_TYPES, isAllowedMime } from './files.js';

describe('isAllowedMime', () => {
  it('accepts every union member listed in ALLOWED_FILE_MIME_TYPES', () => {
    for (const mime of ALLOWED_FILE_MIME_TYPES) {
      expect(isAllowedMime(mime)).toBe(true);
    }
  });

  it('rejects non-allowlisted mimes', () => {
    expect(isAllowedMime('text/x-evil')).toBe(false);
    expect(isAllowedMime('application/x-evil')).toBe(false);
    expect(isAllowedMime('')).toBe(false);
  });

  it('does not split or normalize input — caller is responsible', () => {
    // Defensive check: function does pure membership; "image/png; charset=utf-8" is not in
    // the allowlist (charset attached). Callers must trim/split before checking.
    expect(isAllowedMime('image/png; charset=utf-8')).toBe(false);
    expect(isAllowedMime(' image/png ')).toBe(false);
    expect(isAllowedMime('IMAGE/PNG')).toBe(false);
  });
});
