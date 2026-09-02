/**
 * Renders the illustrated handbook to PDF, and verifies every screenshot actually
 * decoded first. Lazy images are forced to load before printing, otherwise they
 * would come out blank on paper.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const SRC = path.join(__dirname, "handbook-illustrated.html");
const OUT_DIR = "C:/Users/GNG/Desktop/CRM/docs";
const OUT = path.join(OUT_DIR, "Pipeline-AI-Illustrated-Handbook.pdf");

const printCss = `
  :root { color-scheme: light; }
  @page { size: A4; margin: 14mm 13mm 16mm; }
  html, body { background: #fff !important; font-size: 10pt; line-height: 1.5; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .shell { max-width: none; padding: 0; }
  .mast { padding: 0 0 10mm; border-bottom: 2px solid var(--line-strong); break-after: page; min-height: 140mm; display: flex; flex-direction: column; justify-content: center; }
  .mast h1 { font-size: 44pt; }
  .standfirst { font-size: 11.5pt; max-width: 130mm; }
  .cols { display: block; padding: 0; }
  nav.toc { position: static !important; max-height: none !important; overflow: visible !important; break-after: page; columns: 2; column-gap: 12mm; }
  nav.toc::before { content: "Contents"; display: block; column-span: all; font-family: var(--serif); font-size: 24pt; margin-bottom: 6mm; padding-bottom: 3mm; border-bottom: 2px solid var(--line-strong); }
  nav.toc p { break-after: avoid; margin: 4mm 0 1.5mm; }
  nav.toc p:first-of-type { margin-top: 0; }
  nav.toc a { padding: .4mm 0; margin-left: 0; color: var(--ink) !important; text-decoration: none; break-inside: avoid; }
  main { gap: 8mm; }
  h2 { font-size: 19pt; break-after: avoid; break-before: page; margin-top: 0; }
  section:first-child h2 { break-before: avoid; }
  h3 { break-after: avoid; font-size: 10.5pt; }
  p, li { orphans: 3; widows: 3; }
  .note, .tablewrap, pre, ol.steps > li, figure { break-inside: avoid; }
  figure img { max-height: 155mm; object-fit: contain; object-position: left top; width: auto; max-width: 100%; }
  figure.tall img { max-height: 210mm; }
  figcaption { font-size: 8.5pt; }
  table { break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { padding: .5rem .7rem; font-size: 8.5pt; }
  pre { font-size: 8pt; white-space: pre-wrap; }
  a { color: var(--ink) !important; text-decoration: none; }
  footer { break-before: avoid; margin-top: 6mm; }
`;

(async () => {
  const body = fs.readFileSync(SRC, "utf8");
  const splitAt = body.lastIndexOf("</style>");
  const head = body.slice(0, splitAt + "</style>".length);
  const markup = body.slice(splitAt + "</style>".length);

  const doc = `<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8">${head}<style>${printCss}</style></head>
<body>${markup}</body></html>`;

  const tmp = path.join(require("os").tmpdir(), `illustrated-${Date.now()}.html`);
  fs.writeFileSync(tmp, doc, "utf8");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1600 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(`file:///${tmp.replace(/\\/g, "/")}`, { waitUntil: "load", timeout: 120000 });

  // Force every lazy image to load, then confirm each decoded.
  const imgStats = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll("img")];
    imgs.forEach((i) => i.setAttribute("loading", "eager"));
    // Walk the page so the lazy loader fires for everything.
    for (let y = 0; y < document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    return {
      total: imgs.length,
      decoded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.alt.slice(0, 40)),
    };
  });

  console.log(`Images: ${imgStats.decoded}/${imgStats.total} decoded`);
  if (imgStats.broken.length) {
    console.error("BROKEN:", imgStats.broken);
    process.exitCode = 1;
  }

  await new Promise((r) => setTimeout(r, 1500));
  await page.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true, timeout: 180000 });
  await browser.close();
  fs.rmSync(tmp, { force: true });

  console.log(`\nWrote ${OUT}`);
  console.log(`Size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
})();
