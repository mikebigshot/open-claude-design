#!/usr/bin/env node
// fetch-vendor.mjs — download iframe runtime UMD bundles to public/vendor.
//
// Pulls the exact React 18.3.1 + ReactDOM 18.3.1 + @babel/standalone 7.29.0
// versions used by packages/iframe-runtime/build-srcdoc.ts. Once vendored,
// PreviewPanel can render previews against a same-origin path instead of
// unpkg.com — important for OSS self-hosted deployments that want to:
//
//   - Run offline / behind firewalls.
//   - Avoid the runtime supply-chain risk of unpkg serving a poisoned bundle.
//   - Serve under a strict Content-Security-Policy (`script-src 'self'`).
//
// Usage:
//   npm run vendor              # from apps/web — downloads to public/vendor
//
// Then set VITE_VENDOR_RUNTIME=true (e.g. in .env.local or .env.production)
// so PreviewPanel passes `${origin}/vendor` as the CDN base.
//
// Files are committed to source control? — NO. ~4.3MB binaries belong in CI
// artifacts, not git history. The Cloudflare Pages deploy workflow runs
// `npm run vendor` before `vite build` so dist/vendor/ ships with each
// deploy.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public', 'vendor');

// IMPORTANT: keep these versions in sync with REACT_VERSION /
// BABEL_STANDALONE_VERSION in packages/iframe-runtime/src/build-srcdoc.ts.
// Bumping these unilaterally breaks clone-fidelity (per CLAUDE.md §3).
const REACT_VERSION = '18.3.1';
const BABEL_STANDALONE_VERSION = '7.29.0';

const TARGETS = [
  {
    url: `https://unpkg.com/react@${REACT_VERSION}/umd/react.development.js`,
    relPath: `react@${REACT_VERSION}/umd/react.development.js`,
  },
  {
    url: `https://unpkg.com/react-dom@${REACT_VERSION}/umd/react-dom.development.js`,
    relPath: `react-dom@${REACT_VERSION}/umd/react-dom.development.js`,
  },
  {
    url: `https://unpkg.com/@babel/standalone@${BABEL_STANDALONE_VERSION}/babel.min.js`,
    relPath: `@babel/standalone@${BABEL_STANDALONE_VERSION}/babel.min.js`,
  },
];

const FORCE = process.argv.includes('--force');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchOne({ url, relPath }) {
  const dest = join(PUBLIC_DIR, relPath);
  if (!FORCE && (await exists(dest))) {
    process.stdout.write(`✓ ${relPath} (already vendored — pass --force to refetch)\n`);
    return { skipped: true, bytes: 0 };
  }
  process.stdout.write(`→ Fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  process.stdout.write(`✓ ${relPath} (${(buf.byteLength / 1024).toFixed(0)} KB)\n`);
  return { skipped: false, bytes: buf.byteLength };
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });
  let totalBytes = 0;
  let skipped = 0;
  for (const target of TARGETS) {
    const { skipped: s, bytes } = await fetchOne(target);
    if (s) skipped += 1;
    totalBytes += bytes;
  }
  const totalKb = (totalBytes / 1024).toFixed(0);
  process.stdout.write(
    `\nDone. Vendored ${TARGETS.length - skipped} of ${TARGETS.length} bundle(s) — ${totalKb} KB downloaded.\n`,
  );
  process.stdout.write(
    `Set VITE_VENDOR_RUNTIME=true (e.g. in apps/web/.env.local) to enable.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`\nfetch-vendor failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
