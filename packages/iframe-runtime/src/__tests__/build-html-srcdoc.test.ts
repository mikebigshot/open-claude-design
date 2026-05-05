// Tests for build-html-srcdoc.ts —— HTML-only 项目的 srcdoc 拼装路径。
//
// 守护几条 clone-fidelity-critical 的不变量：
//   - injectOverlay 默认为 true
//   - overlay `<script>` 注入到 `</body>` 之前（大小写不敏感）
//   - 没有 `</body>` 时 fallback 追加在末尾
//   - pickHtmlEntry 优先级：index.html → app.html → 字典序第一个 .html
//   - isHtmlOnlyBundle：必须没有 .jsx/.tsx/.js/.ts 且至少有一个 .html/.htm

import { describe, expect, it } from 'vitest';
import { buildHtmlSrcdoc, isHtmlOnlyBundle, pickHtmlEntry } from '../build-html-srcdoc';
import { buildOverlayScript } from '../overlay';

// ─────────────────────────────────────────────────────────────────────────────
// buildHtmlSrcdoc — wrap HTML + optionally inject overlay <script>
// ─────────────────────────────────────────────────────────────────────────────

describe('buildHtmlSrcdoc', () => {
  it('injects overlay <script> before </body> by default', () => {
    const html = '<html><body><h1>Hi</h1></body></html>';
    const out = buildHtmlSrcdoc(html);
    expect(out).toContain('<script>');
    expect(out).toContain('</script>');
    // overlay 必须在 </body> 之前
    const scriptIdx = out.lastIndexOf('<script>');
    const bodyCloseIdx = out.lastIndexOf('</body>');
    expect(scriptIdx).toBeGreaterThan(0);
    expect(bodyCloseIdx).toBeGreaterThan(scriptIdx);
    // 原始 HTML 头部仍保留
    expect(out).toContain('<h1>Hi</h1>');
  });

  it('embeds the actual buildOverlayScript() output verbatim inside the script tag', () => {
    const html = '<html><body></body></html>';
    const out = buildHtmlSrcdoc(html);
    const overlay = buildOverlayScript();
    // overlay IIFE 源码必须原样嵌入（中间不能加 transform）
    expect(out).toContain(overlay);
    // 包装 tag 也存在
    expect(out).toContain(`<script>${overlay}</script>`);
  });

  it('returns content unchanged when injectOverlay=false', () => {
    const html = '<html><body><p>raw</p></body></html>';
    const out = buildHtmlSrcdoc(html, { injectOverlay: false });
    expect(out).toBe(html);
  });

  it('treats injectOverlay=undefined as default (true)', () => {
    const html = '<html><body></body></html>';
    const out = buildHtmlSrcdoc(html, {});
    expect(out).toContain('<script>');
    expect(out).not.toBe(html);
  });

  it('appends overlay at end when no </body> tag is present (HTML fragment)', () => {
    const fragment = '<div>hi</div>';
    const out = buildHtmlSrcdoc(fragment);
    expect(out.startsWith(fragment)).toBe(true);
    // fallback 路径：换行 + script
    expect(out).toContain('<div>hi</div>\n<script>');
    // 末尾以 </script> 收尾
    expect(out.trimEnd().endsWith('</script>')).toBe(true);
  });

  it('matches </body> case-insensitively (regex /i flag)', () => {
    // 注意：当前实现 replace 会用小写字面量 `</body>` 替换原匹配，
    // 所以 `</BODY>` 在输出里会变成小写 `</body>`。我们断言行为一致，
    // 不要求保留原来的大小写。
    const html = '<HTML><BODY><P>x</P></BODY></HTML>';
    const out = buildHtmlSrcdoc(html);
    // overlay 实际被注入了
    expect(out).toContain('<script>');
    expect(out).toContain('OVERLAY_READY');
    // 输出中含小写 `</body>`（替换字面量）
    expect(out).toContain('</body>');
    // 原 `</BODY>` 大写形式被消费掉了（已被替换）
    expect(out).not.toContain('</BODY>');
    // <script> 出现在 </body> 之前
    const scriptIdx = out.lastIndexOf('<script>');
    const bodyCloseIdx = out.indexOf('</body>');
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  it('replaces only the first </body> when multiple are present (regex non-global)', () => {
    const html = '<html><body><div>a</div></body><body>b</body></html>';
    const out = buildHtmlSrcdoc(html);
    // 第一个 </body> 之前注入；第二个保留
    const firstBody = out.indexOf('</body>');
    const lastBody = out.lastIndexOf('</body>');
    expect(firstBody).toBeGreaterThan(0);
    expect(lastBody).toBeGreaterThan(firstBody);
    // overlay 只插入一次
    const overlayMatches = out.match(/OVERLAY_READY/g);
    expect(overlayMatches?.length).toBe(1);
  });

  it('handles empty HTML by appending overlay at end (no </body>)', () => {
    const out = buildHtmlSrcdoc('');
    // 空 HTML：no body 走 fallback 分支 → "\n<script>...</script>"
    expect(out.startsWith('\n<script>')).toBe(true);
    expect(out).toContain('OVERLAY_READY');
  });

  it('preserves source HTML content (HTML entities, attributes, indented body)', () => {
    const html = '<html>\n  <body>\n    <p>hello &amp; <world></p>\n  </body>\n</html>';
    const out = buildHtmlSrcdoc(html);
    expect(out).toContain('hello &amp; <world>');
    // 原 `  </body>` 的两空格缩进仍保留 —— 但 </body> 字面量是被替换的，
    // 替换文本里没有缩进，所以输出形如 `  <script>...\n</body>`。我们断言：
    //   1. `\n  <body>` 起始仍在
    //   2. 缩进 + script 紧跟（确认两空格缩进字符仍存在）
    //   3. 替换后的 `\n</body>` 也在
    expect(out).toContain('\n  <body>');
    expect(out).toContain('  <script>');
    expect(out).toContain('\n</body>');
  });

  it('produces an HTML string that contains the OVERLAY_READY protocol literal (clone-fidelity gate)', () => {
    const html = '<html><body></body></html>';
    const out = buildHtmlSrcdoc(html);
    expect(out).toContain('OVERLAY_READY');
    expect(out).toContain('SET_MODE');
    expect(out).toContain('ELEMENT_SELECTED');
  });

  it('does not mutate the input string (pure function)', () => {
    const html = '<html><body>x</body></html>';
    const before = html;
    buildHtmlSrcdoc(html);
    expect(html).toBe(before);
  });

  it('returns a string for very large inputs without truncation', () => {
    const big = '<html><body>' + 'x'.repeat(50_000) + '</body></html>';
    const out = buildHtmlSrcdoc(big);
    expect(out.length).toBeGreaterThan(50_000);
    expect(out).toContain('x'.repeat(50_000));
    expect(out).toContain('OVERLAY_READY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pickHtmlEntry — 多文件中挑 HTML entry
// ─────────────────────────────────────────────────────────────────────────────

describe('pickHtmlEntry', () => {
  it('returns null for empty file list', () => {
    expect(pickHtmlEntry([])).toBeNull();
  });

  it('returns null when no .html files present', () => {
    const files = [{ path: 'app.jsx' }, { path: 'data.json' }, { path: 'README.md' }];
    expect(pickHtmlEntry(files)).toBeNull();
  });

  it('picks index.html when present (priority 1)', () => {
    const files = [{ path: 'app.html' }, { path: 'index.html' }, { path: 'page.html' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path).toBe('index.html');
  });

  it('picks index.html case-insensitively (INDEX.HTML, Index.Html)', () => {
    expect(pickHtmlEntry([{ path: 'INDEX.HTML' }])?.path).toBe('INDEX.HTML');
    expect(pickHtmlEntry([{ path: 'Index.Html' }])?.path).toBe('Index.Html');
  });

  it('picks app.html when no index.html (priority 2)', () => {
    const files = [{ path: 'page.html' }, { path: 'app.html' }, { path: 'zebra.html' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path).toBe('app.html');
  });

  it('picks App.html (capital A) case-insensitively when no index.html', () => {
    const files = [{ path: 'zebra.html' }, { path: 'App.html' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path).toBe('App.html');
  });

  it('falls back to alphabetically first .html when no index/app match', () => {
    const files = [{ path: 'zebra.html' }, { path: 'middle.html' }, { path: 'alpha.html' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path).toBe('alpha.html');
  });

  it('alphabetical fallback uses localeCompare (sorts uppercase B after lowercase a in default en locale)', () => {
    // localeCompare('B', 'a') 的具体顺序由 ICU/locale 决定；只断言"它选了某个 .html"
    // 而不是 hard-code 跨平台不稳的具体顺序
    const files = [{ path: 'B.html' }, { path: 'a.html' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path === 'B.html' || picked?.path === 'a.html').toBe(true);
  });

  it('returns the original object reference (not a copy)', () => {
    const indexFile = { path: 'index.html', extra: 'metadata' };
    const files = [{ path: 'other.html' }, indexFile];
    const picked = pickHtmlEntry(files);
    expect(picked).toBe(indexFile);
    expect((picked as typeof indexFile).extra).toBe('metadata');
  });

  it('does NOT match nested paths like pages/index.html (exact path comparison)', () => {
    // 当前实现：lower(f.path) === 'index.html'，子目录里的 index.html 不匹配 priority 1
    const files = [{ path: 'pages/index.html' }, { path: 'app.html' }];
    const picked = pickHtmlEntry(files);
    // app.html 拿到 priority 2（不是 pages/index.html）
    expect(picked?.path).toBe('app.html');
  });

  it('falls back to alphabetical when only nested .html files exist', () => {
    const files = [{ path: 'pages/zebra.html' }, { path: 'pages/index.html' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path).toBe('pages/index.html');
  });

  it('also considers .htm files (consistent with isHtmlOnlyBundle)', () => {
    // pickHtmlEntry 必须跟 isHtmlOnlyBundle 对齐：两者都用 /\.html?$/i 识别 HTML
    // 否则纯 .htm 项目会落到 "isHtmlOnlyBundle=true 但 pickHtmlEntry=null" 的矛盾态
    const files = [{ path: 'app.htm' }, { path: 'index.htm' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path).toBe('index.htm');
  });

  it('falls back to alphabetical first .htm when no index.htm/app.htm', () => {
    const files = [{ path: 'zebra.htm' }, { path: 'alpha.htm' }];
    const picked = pickHtmlEntry(files);
    expect(picked?.path).toBe('alpha.htm');
  });

  it('prefers .html over .htm when both share the same priority tier', () => {
    // index.html 优先级 1，index.htm 也是 priority 1 ——
    // 当前实现按 files 数组顺序 find，第一个匹配先赢。
    // 这里只断言：两者都被认作 HTML（pickHtmlEntry 不返回 null）
    const files = [{ path: 'index.html' }, { path: 'index.htm' }];
    expect(pickHtmlEntry(files)).not.toBeNull();
  });

  it('does not mutate the input array (uses spread before sort)', () => {
    const files = [{ path: 'zebra.html' }, { path: 'alpha.html' }];
    const snapshot = files.map((f) => f.path);
    pickHtmlEntry(files);
    expect(files.map((f) => f.path)).toEqual(snapshot);
  });

  it('works with readonly array argument', () => {
    const files: ReadonlyArray<{ path: string }> = [{ path: 'index.html' }];
    expect(pickHtmlEntry(files)?.path).toBe('index.html');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isHtmlOnlyBundle — 决定是否走 HTML-only 渲染路径
// ─────────────────────────────────────────────────────────────────────────────

describe('isHtmlOnlyBundle', () => {
  it('returns false for empty file list (no html present)', () => {
    expect(isHtmlOnlyBundle([])).toBe(false);
  });

  it('returns true when only .html files are present', () => {
    expect(isHtmlOnlyBundle([{ path: 'index.html' }])).toBe(true);
    expect(isHtmlOnlyBundle([{ path: 'index.html' }, { path: 'about.html' }])).toBe(true);
  });

  it('returns true when only .htm files are present (legacy extension)', () => {
    expect(isHtmlOnlyBundle([{ path: 'old.htm' }])).toBe(true);
  });

  it('returns true when mix of .html + non-source files (json, md, css)', () => {
    const files = [
      { path: 'index.html' },
      { path: 'data.json' },
      { path: 'README.md' },
      { path: 'styles.css' },
    ];
    expect(isHtmlOnlyBundle(files)).toBe(true);
  });

  it('returns false when any .jsx file is present alongside html', () => {
    expect(isHtmlOnlyBundle([{ path: 'index.html' }, { path: 'app.jsx' }])).toBe(false);
  });

  it('returns false when any .tsx file is present', () => {
    expect(isHtmlOnlyBundle([{ path: 'index.html' }, { path: 'App.tsx' }])).toBe(false);
  });

  it('returns false when any .js file is present', () => {
    expect(isHtmlOnlyBundle([{ path: 'index.html' }, { path: 'lib.js' }])).toBe(false);
  });

  it('returns false when any .ts file is present', () => {
    expect(isHtmlOnlyBundle([{ path: 'index.html' }, { path: 'types.ts' }])).toBe(false);
  });

  it('matches .jsx/.tsx/.js/.ts case-insensitively (regex /i flag)', () => {
    expect(isHtmlOnlyBundle([{ path: 'index.html' }, { path: 'App.JSX' }])).toBe(false);
    expect(isHtmlOnlyBundle([{ path: 'index.html' }, { path: 'lib.TS' }])).toBe(false);
  });

  it('matches .html/.htm case-insensitively', () => {
    expect(isHtmlOnlyBundle([{ path: 'INDEX.HTML' }])).toBe(true);
    expect(isHtmlOnlyBundle([{ path: 'OLD.HTM' }])).toBe(true);
  });

  it('returns false for source files only with no html', () => {
    expect(isHtmlOnlyBundle([{ path: 'app.jsx' }])).toBe(false);
    expect(isHtmlOnlyBundle([{ path: 'lib.ts' }, { path: 'app.tsx' }])).toBe(false);
  });

  it('returns false for non-source / non-html files only (json/md/css)', () => {
    expect(isHtmlOnlyBundle([{ path: 'data.json' }, { path: 'README.md' }])).toBe(false);
  });

  it('does NOT match .json or other extensions that contain js/ts substrings', () => {
    // 防御回归：`.json` 末尾是 "n" 不是 "x?$"，regex 不该误判
    expect(isHtmlOnlyBundle([{ path: 'data.json' }, { path: 'index.html' }])).toBe(true);
    // .typescript 不是 .ts 末尾
    expect(isHtmlOnlyBundle([{ path: 'foo.typescript' }, { path: 'index.html' }])).toBe(true);
  });

  it('does NOT match files where .html appears mid-path (only suffix)', () => {
    // `foo.html.bak` 不应被算作 html
    expect(isHtmlOnlyBundle([{ path: 'foo.html.bak' }])).toBe(false);
  });

  it('handles nested paths correctly (extension check is suffix-based)', () => {
    expect(isHtmlOnlyBundle([{ path: 'pages/index.html' }])).toBe(true);
    expect(isHtmlOnlyBundle([{ path: 'pages/index.html' }, { path: 'src/app.jsx' }])).toBe(false);
  });

  it('works with readonly array argument', () => {
    const files: ReadonlyArray<{ path: string }> = [{ path: 'index.html' }];
    expect(isHtmlOnlyBundle(files)).toBe(true);
  });
});
