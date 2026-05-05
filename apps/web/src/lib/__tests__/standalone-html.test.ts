import { describe, expect, it } from 'vitest';

import {
  buildStandaloneHtml,
  deriveStandaloneHtmlFilename,
} from '../standalone-html';

describe('deriveStandaloneHtmlFilename', () => {
  it('appends " Prototype.html" suffix to the project name', () => {
    expect(deriveStandaloneHtmlFilename('Demo')).toBe('Demo Prototype.html');
    expect(deriveStandaloneHtmlFilename('My App')).toBe('My App Prototype.html');
  });

  it('replaces filesystem-unsafe characters', () => {
    expect(deriveStandaloneHtmlFilename('foo/bar:baz')).toBe('foo-bar-baz Prototype.html');
    expect(deriveStandaloneHtmlFilename('what?')).toBe('what- Prototype.html');
  });

  it('falls back to "Project" on empty / whitespace name', () => {
    expect(deriveStandaloneHtmlFilename('')).toBe('Project Prototype.html');
    expect(deriveStandaloneHtmlFilename('   ')).toBe('Project Prototype.html');
  });
});

describe('buildStandaloneHtml', () => {
  it('produces well-formed HTML with required head meta + CDN scripts', () => {
    const html = buildStandaloneHtml({
      projectName: 'demo',
      files: [
        { path: 'App.jsx', content: 'function App(){return <h1>hi</h1>;}', mimeType: 'text/jsx' },
      ],
    });
    expect(html).toMatch(/<!DOCTYPE html>/);
    expect(html).toMatch(/<title>demo<\/title>/);
    expect(html).toMatch(/<meta charset="utf-8">/);
    expect(html).toMatch(/<meta name="viewport"/);
    expect(html).toMatch(/preconnect.*fonts\.googleapis\.com/);
    expect(html).toMatch(/<div id="root"><\/div>/);
  });

  it('uses unpkg CDN with SRI integrity for React + Babel', () => {
    const html = buildStandaloneHtml({
      projectName: 'demo',
      files: [{ path: 'App.jsx', content: '<App/>', mimeType: 'text/jsx' }],
    });
    expect(html).toContain('https://unpkg.com/react@18.3.1/umd/react.development.js');
    expect(html).toContain('https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js');
    expect(html).toContain('https://unpkg.com/@babel/standalone@7.29.0/babel.min.js');
    expect(html).toMatch(/integrity="sha384-[A-Za-z0-9+/=]+"/);
    expect(html).toMatch(/crossorigin="anonymous"/);
  });

  it('emits a relative-path script tag for each jsx file (sibling files in zip)', () => {
    const html = buildStandaloneHtml({
      projectName: 'multi',
      files: [
        { path: 'app.jsx', content: 'function App(){}', mimeType: 'text/jsx' },
        { path: 'data.jsx', content: '', mimeType: 'text/jsx' },
        { path: 'styles.css', content: '', mimeType: 'text/css' }, // 非 jsx 不应 emit script
      ],
    });
    expect(html).toContain('<script type="text/babel" src="./app.jsx"');
    expect(html).toContain('<script type="text/babel" src="./data.jsx"');
    expect(html).not.toContain('src="./styles.css"');
  });

  it('appends auto entry call when bundle has no ReactDOM.createRoot(...).render(...)', () => {
    const html = buildStandaloneHtml({
      projectName: 'no-entry',
      files: [{ path: 'App.jsx', content: 'function App(){return null;}', mimeType: 'text/jsx' }],
    });
    expect(html).toMatch(/ReactDOM\.createRoot\(document\.getElementById\('root'\)\)\.render/);
    expect(html).toMatch(/<App \/>/);
  });

  it('does NOT append auto entry when bundle already has one', () => {
    const html = buildStandaloneHtml({
      projectName: 'has-entry',
      files: [
        {
          path: 'App.jsx',
          content:
            'function App(){return null;}\nReactDOM.createRoot(document.getElementById("root")).render(<App />);',
          mimeType: 'text/jsx',
        },
      ],
    });
    // 含一次匹配（用户 jsx 内的）；不应有第二次（未追加）
    const matches = html.match(/ReactDOM\.createRoot\(/g) ?? [];
    expect(matches.length).toBe(0); // user's call lives in the jsx file, not the html
  });

  it('escapes title HTML to prevent XSS via project name', () => {
    const html = buildStandaloneHtml({
      projectName: '<script>alert(1)</script>',
      files: [{ path: 'App.jsx', content: '', mimeType: 'text/jsx' }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('orders jsx files by sortFilesForExecution (data/themes first, App last)', () => {
    const html = buildStandaloneHtml({
      projectName: 'ordered',
      files: [
        { path: 'app.jsx', content: '', mimeType: 'text/jsx' },
        { path: 'screen-test.jsx', content: '', mimeType: 'text/jsx' },
        { path: 'data.jsx', content: '', mimeType: 'text/jsx' },
        { path: 'primitives.jsx', content: '', mimeType: 'text/jsx' },
      ],
    });
    const idx = (s: string) => html.indexOf(s);
    // data.jsx (10) < primitives.jsx (20) < screen-test.jsx (50) < app.jsx (40 unless EDITMODE)
    // 我们 fallback 排序: data → primitives → app → screen-test
    // 实际上 sortFilesForExecution: data(10) < primitives(20) < app.jsx (40, default)
    //   < screen-test.jsx (50)
    expect(idx('src="./data.jsx"')).toBeLessThan(idx('src="./primitives.jsx"'));
    expect(idx('src="./primitives.jsx"')).toBeLessThan(idx('src="./app.jsx"'));
    expect(idx('src="./app.jsx"')).toBeLessThan(idx('src="./screen-test.jsx"'));
  });
});

