// Tests for Tweaks bridge setup / listener / full build.
//
// 字符串生成器，出力都是 IIFE 形式注入到 iframe srcdoc。
// clone-fidelity-critical 字面量：
//   - postMessage type: `codesign:tweaks:update`
//   - Babel preset: `['react']`
//   - EDITMODE 标记：`/*EDITMODE-BEGIN*/` / `/*EDITMODE-END*/`
//   - window state 门缝：`window.__codesign_tweaks__`

import { describe, expect, it } from 'vitest';
import { patchCreateRootForReconcile } from './cached-root';
import {
  buildTweaksBridge,
  buildTweaksBridgeListener,
  buildTweaksBridgeSetup,
} from './tweaks-bridge';

describe('buildTweaksBridgeSetup', () => {
  it('returns the cached-root patch verbatim', () => {
    expect(buildTweaksBridgeSetup()).toBe(patchCreateRootForReconcile());
  });
});

describe('buildTweaksBridgeListener', () => {
  it('returns a non-empty IIFE-wrapped string', () => {
    const src = buildTweaksBridgeListener();
    expect(src.length).toBeGreaterThan(0);
    expect(src.trim().startsWith('(function')).toBe(true);
    expect(src.trim().endsWith(')();')).toBe(true);
  });

  it('contains the codesign:tweaks:update message type literal', () => {
    expect(buildTweaksBridgeListener()).toContain("'codesign:tweaks:update'");
  });

  it('contains EDITMODE-BEGIN and EDITMODE-END markers in regex form', () => {
    const src = buildTweaksBridgeListener();
    expect(src).toContain('EDITMODE-BEGIN');
    expect(src).toContain('EDITMODE-END');
  });

  it("references window.Babel.transform with presets: ['react']", () => {
    const src = buildTweaksBridgeListener();
    expect(src).toContain('window.Babel.transform');
    expect(src).toContain("presets: ['react']");
  });
});

describe('buildTweaksBridge', () => {
  it('concatenates setup + newline + listener', () => {
    expect(buildTweaksBridge()).toBe(buildTweaksBridgeSetup() + '\n' + buildTweaksBridgeListener());
  });

  it('contains all clone-fidelity-critical literals (regression gate)', () => {
    const src = buildTweaksBridge();
    expect(src).toContain('window.__codesign_tweaks__');
    expect(src).toContain("'codesign:tweaks:update'");
    expect(src).toContain('EDITMODE-BEGIN');
    expect(src).toContain('EDITMODE-END');
  });
});
