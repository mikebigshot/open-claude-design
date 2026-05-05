// Sanity check: the version constants embedded in fetch-vendor.mjs MUST
// match the ones the iframe runtime hard-codes in build-srcdoc.ts. If they
// drift, vendoring downloads the wrong files and previews break in
// production with a 404 on `/vendor/react@<other-ver>/...`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Test file lives at apps/web/src/__tests__/, so:
//   ../../scripts/fetch-vendor.mjs              → the vendor script
//   ../../../../packages/iframe-runtime/src/...  → the runtime version source
const FETCH_SCRIPT = join(__dirname, '..', '..', 'scripts', 'fetch-vendor.mjs');
const BUILD_SRCDOC = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'iframe-runtime',
  'src',
  'build-srcdoc.ts',
);

function extractVersion(source: string, constName: string): string | null {
  const match = source.match(new RegExp(`const\\s+${constName}\\s*=\\s*['"]([^'"]+)['"]`));
  return match?.[1] ?? null;
}

describe('fetch-vendor.mjs version pinning', () => {
  const fetchScript = readFileSync(FETCH_SCRIPT, 'utf8');
  const buildSrcdoc = readFileSync(BUILD_SRCDOC, 'utf8');

  it('REACT_VERSION matches build-srcdoc.ts', () => {
    expect(extractVersion(fetchScript, 'REACT_VERSION')).toBe(
      extractVersion(buildSrcdoc, 'REACT_VERSION'),
    );
  });

  it('BABEL_STANDALONE_VERSION matches build-srcdoc.ts', () => {
    expect(extractVersion(fetchScript, 'BABEL_STANDALONE_VERSION')).toBe(
      extractVersion(buildSrcdoc, 'BABEL_STANDALONE_VERSION'),
    );
  });

  it('targets the three expected unpkg URLs', () => {
    expect(fetchScript).toMatch(/unpkg\.com\/react@/);
    expect(fetchScript).toMatch(/unpkg\.com\/react-dom@/);
    expect(fetchScript).toMatch(/unpkg\.com\/@babel\/standalone@/);
  });

  it('writes into apps/web/public/vendor (not somewhere else)', () => {
    expect(fetchScript).toMatch(/public['"\s,]+['"]vendor/);
  });
});
