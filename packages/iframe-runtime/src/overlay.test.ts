// Tests for OVERLAY_SCRIPT + Tweaks bridge string contents.
//
// 这些断言守护 clone-fidelity-critical 协议字符串 + 关键防御机制。
// 改 overlay.ts 时如果不小心删了某个字符串，这里会立刻失败。

import { describe, expect, it } from 'vitest';
import { buildOverlayScript } from './overlay';
import {
  buildTweaksBridge,
  buildTweaksBridgeSetup,
  buildTweaksBridgeListener,
} from './tweaks-bridge';
import { patchCreateRootForReconcile } from './cached-root';

describe('buildOverlayScript', () => {
  it('returns IIFE source ready to inject as <script> body', () => {
    const src = buildOverlayScript();
    expect(src.startsWith('(function')).toBe(true);
    expect(src.endsWith(';')).toBe(true);
  });

  it('contains all clone-fidelity protocol strings', () => {
    const src = buildOverlayScript();
    expect(src).toContain('SET_MODE');
    expect(src).toContain('EDIT_STYLE');
    expect(src).toContain('CLEAR_PIN');
    expect(src).toContain('OVERLAY_READY');
    expect(src).toContain('ELEMENT_SELECTED');
    expect(src).toContain('IFRAME_ERROR');
    expect(src).toContain('__codesign');
    expect(src).toContain('data-codesign-id');
  });

  it('includes the three-tier selector strategy (data-codesign-id → id → XPath)', () => {
    const src = buildOverlayScript();
    expect(src).toContain('codesignId');
    expect(src).toContain("'#'");
    expect(src).toContain('previousElementSibling');
  });

  it('includes the 200ms reattach interval (defense-in-depth against AI removeEventListener)', () => {
    const src = buildOverlayScript();
    expect(src).toContain('setInterval(reattach, 200)');
  });

  it('uses capture: true on document listeners', () => {
    const src = buildOverlayScript();
    // addEventListener calls in installs[] use the third arg `true` (capture).
    expect(src).toMatch(/addEventListener\(spec\.evt, spec\.fn, true\)/);
  });

  it('installs navguard (window.open / location.assign / location.replace no-ops)', () => {
    const src = buildOverlayScript();
    expect(src).toContain('window.open');
    expect(src).toContain('loc.assign');
    expect(src).toContain('loc.replace');
  });

  it('exposes the EDIT_PROPS list with computed style names', () => {
    const src = buildOverlayScript();
    for (const prop of [
      'width',
      'height',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'border-width',
      'border-style',
      'border-color',
      'border-radius',
      'background-color',
      'color',
      'font-size',
      'font-family',
      'opacity',
    ]) {
      expect(src).toContain(`'${prop}'`);
    }
  });

  it('does not contain literal close-script tags (would break iframe HTML)', () => {
    const src = buildOverlayScript();
    expect(src).not.toContain('</script>');
  });
});

describe('Tweaks bridge', () => {
  it('setup patches ReactDOM.createRoot to cache the root', () => {
    const src = buildTweaksBridgeSetup();
    expect(src).toContain('window.ReactDOM.createRoot');
    expect(src).toContain('window.__codesign_tweaks__');
    expect(src).toContain('originalScript');
  });

  it('listener subscribes to codesign:tweaks:update message', () => {
    const src = buildTweaksBridgeListener();
    expect(src).toContain('codesign:tweaks:update');
    expect(src).toContain('Babel.transform');
    expect(src).toContain("presets: ['react']");
    expect(src).toContain("new Function('React', 'ReactDOM'");
  });

  it('listener uses EDITMODE regex matching the protocol markers', () => {
    const src = buildTweaksBridgeListener();
    // 直接断言出现转义后的 BEGIN / END 关键词
    expect(src).toContain('EDITMODE-BEGIN');
    expect(src).toContain('EDITMODE-END');
  });

  it('combined buildTweaksBridge has both setup and listener', () => {
    const src = buildTweaksBridge();
    expect(src).toContain('window.__codesign_tweaks__');
    expect(src).toContain('codesign:tweaks:update');
  });

  it('patchCreateRootForReconcile is the same as buildTweaksBridgeSetup (alias by design)', () => {
    expect(patchCreateRootForReconcile()).toBe(buildTweaksBridgeSetup());
  });
});
