---
name: Save as standalone HTML
description: Bundle the project into a single self-contained HTML file that works offline — every script, style, image and font inlined as data URIs.
trigger:
  keywords: [standalone, "single file", "offline", "self contained", "self-contained", export html, save html, "导出 html", "单文件", "离线"]
od:
  mode: design
  preview:
    type: html
    entry: index.html
references: []
---

# Save as standalone HTML

When the user wants a **single HTML file** they can email, drop in a slack, or open from a USB stick. The output must work fully offline — no CDN loads, no relative file references, no missing fonts.

## Workflow

1. Confirm which entry the user wants bundled (`index.html`, the deck's HTML, etc.). If unclear, pick the project's primary preview entry.
2. Ensure the entry has:
   - A `<template id="__bundler_thumbnail">` containing a small SVG (≤ 2KB, 30% padding) — used as a splash while the inlined assets decode and as a no-JS fallback.
   - A `<title>` that matches the deck/page subject.
3. Call `super_inline_html({ input_path, output_path })`. The tool walks the HTML, inlines every referenced `.css` / `.js` / `<img>` / `<link rel="stylesheet">` / web font / `meta ext-resource-dependency` as a data URI, and writes the result to `output_path`.
4. After the tool returns, call `present_fs_item_for_download({ path: output_path, label: "<Title>.html" })` so the user gets a download card.

## Things to watch

- **Fonts**: if the artifact uses Google Fonts via `<link href="https://fonts.googleapis.com/...">`, those become inline `@font-face` data URIs in the bundle. Keep the family list short (≤ 2) to avoid blowing up bundle size.
- **External script tags**: anything still loaded from a CDN at runtime will FAIL when the user opens the file offline. Prefer `pin_external` style explicit dependency declarations the bundler can inline.
- **Iframes / canvases / videos**: bundler can inline source frames but cannot inline live streams. Mention this to the user if the deck contains one.
- **File size**: a clean deck typically lands at 200KB – 2MB. If the bundle is >10MB the user almost certainly has unnecessarily large images — confirm before continuing.

## Done criteria

- `super_inline_html` returned successfully (no validation flags)
- `present_fs_item_for_download` triggered a visible download card
- Opening the resulting file with the network disconnected renders identical pixels to the live preview
- Call `done`

## Anti-slop

- Don't bundle if the user only asked for a "share link" — that's a different feature
- Don't inline assets that are loaded conditionally (lazy routes, code-split chunks) without warning the user
- Don't change the design while bundling — the bundler is a serializer, not a redesign opportunity
