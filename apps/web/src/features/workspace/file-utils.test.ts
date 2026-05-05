import { describe, expect, it } from 'vitest';
import { isHtmlPath, pickEntry, sectionFor } from './file-utils';
import type { FileRecord } from '@open-design/contracts';

const f = (path: string, mimeType: string): FileRecord => ({
  projectId: 'p1',
  path,
  sha256: 'h',
  size: 1,
  mimeType: mimeType as FileRecord['mimeType'],
  updatedAt: new Date().toISOString(),
});

describe('pickEntry', () => {
  // HTML-first：导入项目时如果含 standalone HTML wrapper，应优先选它而不是
  // 兄弟 jsx，这样 zip-import 进来的项目能直接渲染。

  it('returns null for empty list', () => {
    expect(pickEntry([])).toBeNull();
  });

  it('always prefers .html over .jsx (HTML-first)', () => {
    expect(pickEntry(['App.jsx', 'index.html'])).toBe('index.html');
    expect(pickEntry(['index.html', 'App.jsx'])).toBe('index.html');
  });

  it('prefers index.html among multiple html', () => {
    expect(pickEntry(['demo.html', 'index.html', 'about.html'])).toBe('index.html');
  });

  it('prefers app.html if no index.html', () => {
    expect(pickEntry(['demo.html', 'app.html', 'about.html'])).toBe('app.html');
  });

  it('falls back to alphabetic .html when no canonical name', () => {
    expect(pickEntry(['z.html', 'a.html', 'm.html'])).toBe('a.html');
  });

  it('matches partial name: "Owlie - Index.html" via index substring', () => {
    expect(pickEntry(['Owlie - Index.html', 'about.html'])).toBe('Owlie - Index.html');
  });

  it('jsx-only project: falls back to App.jsx > App.tsx > index.jsx > first .jsx', () => {
    // 没 .html 时回退到 React-first（保留旧 jsx-only 项目兼容）
    expect(pickEntry(['App.tsx', 'App.jsx'])).toBe('App.jsx');
    expect(pickEntry(['App.tsx', 'index.tsx'])).toBe('App.tsx');
    expect(pickEntry(['index.tsx', 'index.jsx'])).toBe('index.jsx');
    expect(pickEntry(['notes.md', 'Helper.jsx', 'Other.tsx'])).toBe('Helper.jsx');
  });

  it('returns null when nothing matches', () => {
    expect(pickEntry(['notes.md', 'data.json'])).toBeNull();
  });

  it('is case-insensitive on entry candidates', () => {
    expect(pickEntry(['app.jsx'])).toBe('app.jsx');
    expect(pickEntry(['APP.JSX'])).toBe('APP.JSX');
  });

  it('nested-path App.jsx still picked as fallback when no html', () => {
    expect(pickEntry(['src/App.jsx'])).toBe('src/App.jsx');
  });

  it('"<Name> Prototype.html" wrapper (zip-export产物) is picked over sibling jsx files', () => {
    // 实际场景: import zip 后，pickEntry 应自动选 '<Project Name> Prototype.html'
    expect(
      pickEntry([
        'app.jsx',
        'data.jsx',
        'screen-test.jsx',
        'Demo Prototype.html',
      ]),
    ).toBe('Demo Prototype.html');
  });
});

describe('sectionFor', () => {
  it('returns PAGES for text/html', () => {
    expect(sectionFor(f('Foo.html', 'text/html'))).toBe('PAGES');
  });

  it('returns COMPONENTS for text/jsx (区分 page vs component)', () => {
    expect(sectionFor(f('App.jsx', 'text/jsx'))).toBe('COMPONENTS');
  });

  it('returns SCRIPTS for text/javascript', () => {
    expect(sectionFor(f('helper.js', 'text/javascript'))).toBe('SCRIPTS');
  });

  it('returns SCRIPTS for text/css', () => {
    expect(sectionFor(f('styles.css', 'text/css'))).toBe('SCRIPTS');
  });

  it('returns IMAGES for image/svg+xml', () => {
    expect(sectionFor(f('icon.svg', 'image/svg+xml'))).toBe('IMAGES');
  });

  it('returns IMAGES for image/png', () => {
    expect(sectionFor(f('logo.png', 'image/png'))).toBe('IMAGES');
  });

  it('returns OTHER for application/json', () => {
    expect(sectionFor(f('data.json', 'application/json'))).toBe('OTHER');
  });

  it('returns OTHER for text/plain', () => {
    expect(sectionFor(f('notes.txt', 'text/plain'))).toBe('OTHER');
  });
});

describe('isHtmlPath', () => {
  it('returns true for .html', () => {
    expect(isHtmlPath('index.html')).toBe(true);
    expect(isHtmlPath('subdir/page.html')).toBe(true);
  });

  it('returns true for .htm', () => {
    expect(isHtmlPath('legacy.htm')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isHtmlPath('Index.HTML')).toBe(true);
  });

  it('returns false for jsx/js/css/etc', () => {
    expect(isHtmlPath('App.jsx')).toBe(false);
    expect(isHtmlPath('helper.js')).toBe(false);
    expect(isHtmlPath('styles.css')).toBe(false);
    expect(isHtmlPath('data.json')).toBe(false);
  });

  it('does not match the special PREVIEW_TAB sentinel', () => {
    expect(isHtmlPath('Preview')).toBe(false);
    expect(isHtmlPath('Design Files')).toBe(false);
  });
});
