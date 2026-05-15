// `__image_ref` protocol — W2's screenshot tool returns
// `{__image_ref: true, path: 'data:image/png;...'}` (single) or an array of
// such refs. The dispatcher / wrapper detects this and feeds the LLM image
// content blocks instead of stringified objects (otherwise the LLM sees
// `[object Object]` and can't actually "see" the screenshot).
//
// v2 reference: main-agent-loop-full.raw.js — the dispatcher's `Ae` closure
// has a branch that turns __image_ref refs into `{type: 'image_ref', path}`
// content blocks. Our AI-SDK-shaped equivalent is `{type: 'image', image: ...}`.

import { describe, expect, it } from 'vitest';
import { IMAGE_REF_KEY, extractImageRefs, isImageRef, toImageContent } from '../image-ref';

describe('__image_ref protocol', () => {
  it('exports the protocol key as "__image_ref"', () => {
    expect(IMAGE_REF_KEY).toBe('__image_ref');
  });

  it('isImageRef accepts well-formed single refs', () => {
    expect(isImageRef({ __image_ref: true, path: 'data:image/png;base64,abc' })).toBe(true);
  });

  it('isImageRef rejects malformed inputs', () => {
    expect(isImageRef(null)).toBe(false);
    expect(isImageRef('data:...')).toBe(false);
    expect(isImageRef({ __image_ref: false, path: 'x' })).toBe(false);
    expect(isImageRef({ __image_ref: true })).toBe(false); // missing path
    expect(isImageRef({ __image_ref: true, path: 42 })).toBe(false);
  });

  it('extractImageRefs returns [] for non-ref values', () => {
    expect(extractImageRefs(null)).toEqual([]);
    expect(extractImageRefs('hello')).toEqual([]);
    expect(extractImageRefs({})).toEqual([]);
    expect(extractImageRefs([1, 2])).toEqual([]);
  });

  it('extractImageRefs handles a single ref', () => {
    const ref = { __image_ref: true as const, path: 'data:image/png;base64,xxx' };
    expect(extractImageRefs(ref)).toEqual([ref.path]);
  });

  it('extractImageRefs handles arrays of refs', () => {
    const refs = [
      { __image_ref: true as const, path: 'data:image/png;base64,a' },
      { __image_ref: true as const, path: 'data:image/png;base64,b' },
    ];
    expect(extractImageRefs(refs)).toEqual(['data:image/png;base64,a', 'data:image/png;base64,b']);
  });

  it('extractImageRefs returns [] when array contains non-refs', () => {
    const mixed = [{ __image_ref: true as const, path: 'data:...' }, { not_a_ref: true }];
    // We don't partial-extract: the dispatcher should treat the whole array
    // as a "regular tool result" if it isn't homogeneous.
    expect(extractImageRefs(mixed)).toEqual([]);
  });

  it('toImageContent yields the AI-SDK image-block shape for one image', () => {
    const content = toImageContent(['data:image/png;base64,xxx']);
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: 'image', image: 'data:image/png;base64,xxx' });
  });

  it('toImageContent handles multiple images', () => {
    const content = toImageContent(['data:1', 'data:2']);
    expect(content).toEqual([
      { type: 'image', image: 'data:1' },
      { type: 'image', image: 'data:2' },
    ]);
  });

  it('toImageContent on empty array returns empty array (caller decides)', () => {
    expect(toImageContent([])).toEqual([]);
  });
});
