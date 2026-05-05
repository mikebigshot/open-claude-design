// Tests for EDITMODE block extract / replace round-trip.
//
// EDITMODE 标记 `/*EDITMODE-BEGIN*/.../*EDITMODE-END*/` clone-fidelity-critical —— 改任一字符
// 都会让 Tweaks bridge 找不到块、无法重编译 artifact。

import { describe, expect, it } from 'vitest';
import {
  EDITMODE_BEGIN_MARKER,
  EDITMODE_END_MARKER,
  extractEditModeBlock,
  replaceEditModeBlock,
} from './editmode-protocol';

describe('EDITMODE markers', () => {
  it('uses literal /*EDITMODE-BEGIN*/ / /*EDITMODE-END*/ strings (clone-fidelity)', () => {
    expect(EDITMODE_BEGIN_MARKER).toBe('/*EDITMODE-BEGIN*/');
    expect(EDITMODE_END_MARKER).toBe('/*EDITMODE-END*/');
  });
});

describe('extractEditModeBlock', () => {
  it('extracts JSON body between markers', () => {
    const src = 'const T = /*EDITMODE-BEGIN*/{\n  "primary": "#c96442"\n}/*EDITMODE-END*/;';
    expect(extractEditModeBlock(src)).toBe('{\n  "primary": "#c96442"\n}');
  });

  it('returns null when no EDITMODE block', () => {
    expect(extractEditModeBlock('const T = 42;')).toBeNull();
  });

  it('extracts only the first block when multiple appear (non-greedy)', () => {
    const src =
      'const A = /*EDITMODE-BEGIN*/"first"/*EDITMODE-END*/; ' +
      'const B = /*EDITMODE-BEGIN*/"second"/*EDITMODE-END*/;';
    expect(extractEditModeBlock(src)).toBe('"first"');
  });
});

describe('replaceEditModeBlock', () => {
  it('replaces block body with new JSON string', () => {
    const src = 'const T = /*EDITMODE-BEGIN*/{ "primary": "#c96442" }/*EDITMODE-END*/;';
    const out = replaceEditModeBlock(src, '{ "primary": "#22aa33" }');
    expect(out).toContain('/*EDITMODE-BEGIN*/{ "primary": "#22aa33" }/*EDITMODE-END*/');
    expect(out).not.toContain('#c96442');
  });

  it('returns source unchanged when no EDITMODE block (silent no-op)', () => {
    const src = 'const T = 42;';
    expect(replaceEditModeBlock(src, '{ "any": 1 }')).toBe(src);
  });

  it('round-trips: extract → JSON.parse → mutate → JSON.stringify → replace yields valid bundle', () => {
    const src =
      '// header\nconst T = /*EDITMODE-BEGIN*/{\n  "primary": "#c96442",\n  "size": 16\n}/*EDITMODE-END*/;\nfunction App(){ return <div/>; }';
    const body = extractEditModeBlock(src);
    expect(body).not.toBeNull();
    const obj = JSON.parse(body as string) as Record<string, unknown>;
    obj['primary'] = '#000';
    obj['extra'] = true;
    const newBody = JSON.stringify(obj, null, 2);
    const out = replaceEditModeBlock(src, newBody);
    // 新 bundle 仍包含未受影响的部分
    expect(out).toContain('// header');
    expect(out).toContain('function App()');
    // EDITMODE 块已经更新
    const newBodyExtracted = extractEditModeBlock(out);
    expect(newBodyExtracted).not.toBeNull();
    const reParsed = JSON.parse(newBodyExtracted as string) as Record<string, unknown>;
    expect(reParsed['primary']).toBe('#000');
    expect(reParsed['extra']).toBe(true);
    expect(reParsed['size']).toBe(16);
  });
});
