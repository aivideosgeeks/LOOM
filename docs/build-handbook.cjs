/**
 * Renders the handbook to PDF through headless Chrome so the real stylesheet is used,
 * with a print layout on top: light theme, single column, a proper contents page, and
 * break rules so tables, panels and code blocks are never split across a page.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SRC = path.join(__dirname, "handbook.html");
const OUT_DIR = __dirname;
const OUT = path.join(OUT_DIR, "Pipeline-AI-Handbook.pdf");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const body = fs.readFileSync(SRC, "utf8");

const printCss = `
  /* Paper is light. Force the light token set regardless of the renderer's scheme. */
  :root { color-scheme: light; }

  @page {
    size: A4;
    margin: 16mm 15mm 18mm;
  }

  html, body {
    background: #FFFFFF !important;
    font-size: 10.5pt;
    line-height: 1.55;
  }

  /* Keep the designed colours: Chrome strips backgrounds when printing otherwise. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  .shell { max-width: none; padding: 0; }

  /* The masthead becomes a cover. */
  .mast {
    padding: 0 0 12mm;
    border-bottom: 2px solid var(--line-strong);
    break-after: page;
    min-height: 150mm;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .mast h1 { font-size: 46pt; }
  .standfirst { font-size: 12pt; max-width: 130mm; }

  /* Single column: the sticky rail becomes a contents page. */
  .cols { display: block; padding: 0; }

  nav.toc {
    position: static !important;
    max-height: none !important;
    overflow: visible !important;
    break-after: page;
    columns: 2;
    column-gap: 12mm;
  }
  nav.toc::before {
    content: "Contents";
    display: block;
    column-span: all;
    font-family: var(--serif);
    font-size: 24pt;
    margin-bottom: 6mm;
    padding-bottom: 3mm;
    border-bottom: 2px solid var(--line-strong);
  }
  nav.toc p { break-after: avoid; margin: 4mm 0 1.5mm; }
  nav.toc p:first-of-type { margin-top: 0; }
  nav.toc a {
    padding: .5mm 0;
    margin-left: 0;
    color: var(--ink) !important;
    text-decoration: none;
    break-inside: avoid;
  }

  main { gap: 9mm; }

  /* A heading never sits alone at the foot of a page. */
  section { break-inside: auto; }
  h2 {
    font-size: 20pt;
    break-after: avoid;
    break-before: auto;
    margin-top: 2mm;
  }
  h3 { break-after: avoid; font-size: 11pt; }
  p, li { orphans: 3; widows: 3; }

  /* Blocks that lose their meaning when split. */
  .panel, .note-box, .tablewrap, pre, .gauges, ol.steps > li {
    break-inside: avoid;
  }
  table { break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }

  pre { font-size: 8.5pt; white-space: pre-wrap; word-break: break-word; }
  code { font-size: .88em; }

  a { color: var(--ink) !important; text-decoration: none; }

  footer { break-before: avoid; margin-top: 8mm; }
`;

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${body}
<style>${printCss}</style>
</head>
<body>
</body>
</html>`;

// The guide file is a fragment: <title>, <link>, <style> then content. Split it so the
// head bits stay in <head> and the markup goes in <body>.
const splitAt = body.lastIndexOf("</style>");
const head = body.slice(0, splitAt + "</style>".length);
const markup = body.slice(splitAt + "</style>".length);

const doc = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
${head}
<style>${printCss}</style>
</head>
<body>
${markup}
</body>
</html>`;

const tmp = path.join(os.tmpdir(), `handbook-print-${Date.now()}.html`);
fs.writeFileSync(tmp, doc, "utf8");
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = path.join(os.tmpdir(), `chrome-pdf-${Date.now()}`);
execFileSync(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-pdf-header-footer",
    "--virtual-time-budget=20000",
    `--print-to-pdf=${OUT}`,
    `file:///${tmp.replace(/\\/g, "/")}`,
  ],
  { stdio: "inherit", timeout: 120000 },
);

const size = fs.statSync(OUT).size;
console.log(`\nWrote ${OUT}`);
console.log(`Size: ${(size / 1024).toFixed(0)} KB`);
fs.rmSync(tmp, { force: true });
fs.rmSync(profile, { recursive: true, force: true });
