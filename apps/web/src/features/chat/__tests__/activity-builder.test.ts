import { describe, expect, it } from 'vitest';

import type { CommentPin } from '@/state/types';
import { buildActivityEntries } from '../activity-builder';

const mockTheme = {
  colors: {
    info: '#4A6FA5',
    success: '#5C8A53',
    danger: '#C24545',
    fg300: '#5A574F',
    brandBase: '#C96442',
    brandPress: '#9E4A32',
  },
} as unknown as Parameters<typeof buildActivityEntries>[2];

describe('buildActivityEntries', () => {
  it('returns empty array when no messages or pins', () => {
    expect(buildActivityEntries([], [], mockTheme)).toEqual([]);
  });

  it('extracts tool calls from message parts (only output-available)', () => {
    const out = buildActivityEntries(
      [
        {
          id: 'm1',
          parts: [
            { type: 'tool-edit_file', state: 'output-available', input: { path: 'App.jsx' } },
            { type: 'tool-read_file', state: 'input-streaming', input: { path: 'data.jsx' } },
          ],
        },
      ],
      [],
      mockTheme,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.what).toBe('wrote App.jsx');
    expect(out[0]!.who).toBe('Atelier');
    expect(out[0]!.color).toBe('#4A6FA5');
  });

  it('maps known tool types to verbs (read, list, delete, done)', () => {
    const out = buildActivityEntries(
      [
        {
          id: 'm1',
          parts: [
            { type: 'tool-read_file', state: 'output-available', input: { path: 'a.js' } },
            { type: 'tool-list_files', state: 'output-available', input: { path: '/' } },
            { type: 'tool-delete_file', state: 'output-available', input: { path: 'b.js' } },
            { type: 'tool-mark_done', state: 'output-available', input: { message: 'all set' } },
          ],
        },
      ],
      [],
      mockTheme,
    );
    expect(out.map((e) => e.what)).toEqual([
      'done all set',
      'deleted b.js',
      'listed /',
      'read a.js',
    ]);
  });

  it('falls back to type slice for unknown tool names', () => {
    const out = buildActivityEntries(
      [
        {
          id: 'm1',
          parts: [
            {
              type: 'tool-something_new',
              state: 'output-available',
              input: { path: 'x.txt' },
            },
          ],
        },
      ],
      [],
      mockTheme,
    );
    expect(out[0]!.what).toBe('something_new x.txt');
  });

  it('combines pins with tool events, newest first', () => {
    const pin: CommentPin = {
      id: 'pin-a',
      n: 1,
      x: 100,
      y: 200,
      text: 'fix this',
      selector: '#hero',
      createdAt: '2026-05-02T10:30:00Z',
    };
    const out = buildActivityEntries(
      [
        {
          id: 'm1',
          parts: [{ type: 'tool-edit_file', state: 'output-available', input: { path: 'A.jsx' } }],
        },
      ],
      [pin],
      mockTheme,
    );
    expect(out).toHaveLength(2);
    // newest first → pin (added later in the source array) is reversed last,
    // tool event also reversed; order depends on push sequence
    expect(out[0]!.who).toBe('You');
    expect(out[0]!.what).toBe('commented "fix this"');
    expect(out[1]!.who).toBe('Atelier');
  });

  it('truncates long pin text', () => {
    const longText = 'a'.repeat(80);
    const pin: CommentPin = {
      id: 'p1',
      n: 1,
      x: 0,
      y: 0,
      text: longText,
      createdAt: '2026-05-02T10:30:00Z',
    };
    const out = buildActivityEntries([], [pin], mockTheme);
    expect(out[0]!.what.length).toBeLessThan(60);
    expect(out[0]!.what).toMatch(/…/);
  });

  it('respects limit and keeps newest entries', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      parts: [
        {
          type: 'tool-read_file',
          state: 'output-available',
          input: { path: `file-${i}.js` },
        },
      ],
    }));
    const out = buildActivityEntries(messages, [], mockTheme, 3);
    expect(out).toHaveLength(3);
    // keeps the LAST 3 from chronological order, then reverses → newest first
    expect(out.map((e) => e.what)).toEqual(['read file-9.js', 'read file-8.js', 'read file-7.js']);
  });
});
