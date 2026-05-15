// image-cache — bounded LRU semantics for the view_image canvas pipeline.

import { afterEach, describe, expect, it } from 'vitest';
import { ImageCache, getViewImageCache, _resetViewImageCache } from '../image-cache';

const sample = (n: number) => ({
  base64: `b${n}`,
  mediaType: 'image/jpeg',
  originalBytes: n * 100,
  encodedBytes: n * 50,
});

afterEach(() => _resetViewImageCache());

describe('ImageCache', () => {
  it('stores and retrieves entries by key', () => {
    const c = new ImageCache(3);
    c.set('a', sample(1));
    expect(c.has('a')).toBe(true);
    expect(c.get('a')?.base64).toBe('b1');
  });

  it('evicts the least-recently-used entry when capacity is exceeded', () => {
    const c = new ImageCache(3);
    c.set('a', sample(1));
    c.set('b', sample(2));
    c.set('c', sample(3));
    // d arrives → a (LRU) is evicted
    c.set('d', sample(4));
    expect(c.has('a')).toBe(false);
    expect(c._keys()).toEqual(['b', 'c', 'd']);
  });

  it('promotes an entry to MRU on get', () => {
    const c = new ImageCache(3);
    c.set('a', sample(1));
    c.set('b', sample(2));
    c.set('c', sample(3));
    // touch 'a' → it's now MRU
    c.get('a');
    // d arrives → b is now LRU and gets evicted
    c.set('d', sample(4));
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c._keys()).toEqual(['c', 'a', 'd']);
  });

  it('promotes on overwrite as well', () => {
    const c = new ImageCache(2);
    c.set('a', sample(1));
    c.set('b', sample(2));
    c.set('a', sample(10)); // overwrite — a moves to tail
    c.set('c', sample(3)); // evict b
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.get('a')?.base64).toBe('b10');
  });

  it('delete removes the entry', () => {
    const c = new ImageCache(3);
    c.set('a', sample(1));
    expect(c.delete('a')).toBe(true);
    expect(c.has('a')).toBe(false);
    expect(c.delete('a')).toBe(false);
  });

  it('rejects capacity < 1', () => {
    expect(() => new ImageCache(0)).toThrow();
    expect(() => new ImageCache(-1)).toThrow();
  });

  it('singleton getViewImageCache survives across calls until reset', () => {
    const a = getViewImageCache();
    a.set('k', sample(1));
    const b = getViewImageCache();
    expect(b.get('k')?.base64).toBe('b1');
    _resetViewImageCache();
    const c = getViewImageCache();
    expect(c.has('k')).toBe(false);
  });
});
