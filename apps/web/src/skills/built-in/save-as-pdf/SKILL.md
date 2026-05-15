---
name: Save as PDF
description: Print-ready PDF export — opens the artifact in a new tab tuned for print (clean margins, page-break-friendly layout) so the user prints to PDF via Cmd+P / Ctrl+P.
trigger:
  keywords: [pdf, print, "print ready", "save as pdf", "export pdf", "导出 pdf", "保存 pdf", "打印"]
od:
  mode: design
  preview:
    type: html
    entry: index.html
references: []
---

# Save as PDF

When the user wants a **PDF** of the current design (deck, document, report, dashboard). We don't generate the PDF in-process; we open a print-tuned HTML in a new tab and let the OS print dialog convert. This sidesteps every "but it looks wrong" gotcha that browser-side PDF libs introduce.

## Workflow

1. Identify the target HTML file. For a deck, that's the deck entry (`index.html` or `deck.html`). For a document, the document entry.
2. Add or verify the **print stylesheet** is loaded for `@media print`:

   ```html
   <style>
     @media print {
       @page { size: A4; margin: 14mm; }   /* or "letter" / explicit dims */
       body { background: white; color: black; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
       .no-print { display: none !important; }
       /* one slide per page for decks */
       section[data-screen-label] { break-after: page; page-break-after: always; }
       a { text-decoration: none; color: inherit; }
     }
   </style>
   ```

   For decks, every `<section data-screen-label>` becomes one page automatically.
3. If the artifact has interactive controls (Tweaks, toolbars), wrap them in `.no-print` so they vanish in the printed output.
4. Call `open_for_print({ project_relative_file_path: "<entry>" })`. This opens the file in a new tab. Tell the user: **press Cmd+P (Mac) or Ctrl+P (Windows) and choose "Save as PDF"**.
5. Some decks should be printed in landscape — say so explicitly if the deck has a 16:9 layout: "Set the print orientation to **Landscape** and disable headers/footers."

## Done criteria

- A print stylesheet is in the entry (or already was)
- `open_for_print` returned successfully — the new tab opens
- You explained to the user the exact print-dialog choices (orientation, "Save as PDF", margins if non-default)
- Call `done`

## Anti-slop

- Don't try to write a PDF directly — we don't have a server-side PDF rasterizer, and browser-side libs (`jsPDF`, `html2pdf`) produce subtly wrong layouts (font kerning, gradient banding, image colorspace)
- Don't change the screen design just to make the print look nice — use `@media print` to keep both surfaces alive
- Don't suggest the user "print and scan" — that's user-hostile; we have `open_for_print` for a reason
- Don't forget `print-color-adjust: exact` — without it Chrome strips background colors on print, ruining decks with colored slides
