/** Renders the testing report to PDF through headless Chrome, with a print layout. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const SRC = path.join(__dirname, "testing-report.html");
const OUT = "C:/Users/GNG/Desktop/CRM/docs/Pipeline-AI-Test-Report.pdf";

const printCss = `
  :root { color-scheme: light; }
  @page { size: A4; margin: 16mm 15mm 18mm; }
  html, body { background: #fff !important; font-size: 10pt; line-height: 1.5; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .wrap { max-width: none; padding: 0; }
  h1 { font-size: 34pt; }
  .standfirst { font-size: 11pt; max-width: 140mm; }
  .strip { margin-top: 8mm; break-inside: avoid; }
  .cell .num { font-size: 20pt; }
  section { margin-top: 9mm; }
  h2 { font-size: 18pt; break-after: avoid; }
  h3 { break-after: avoid; font-size: 10.5pt; }
  p, li { orphans: 3; widows: 3; }
  .tablewrap, .note, .finding, .strip { break-inside: avoid; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { padding: .45rem .7rem; font-size: 8.5pt; }
  a { color: var(--ink) !important; text-decoration: none; }
  footer { break-before: avoid; margin-top: 8mm; }
`;

(async () => {
  const body = fs.readFileSync(SRC, "utf8");
  const splitAt = body.lastIndexOf("</style>");
  const head = body.slice(0, splitAt + "</style>".length);
  const markup = body.slice(splitAt + "</style>".length);

  const doc = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">${head}<style>${printCss}</style></head><body>${markup}</body></html>`;
  const tmp = path.join(os.tmpdir(), `report-${Date.now()}.html`);
  fs.writeFileSync(tmp, doc, "utf8");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(`file:///${tmp.replace(/\\/g, "/")}`, { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  fs.rmSync(tmp, { force: true });

  console.log(`Wrote ${OUT}`);
  console.log(`Size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
})();
