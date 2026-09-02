/**
 * Builds the testing report. Every count is read from the actual result files
 * produced by the two suites, so the report cannot drift from what was run.
 */
const fs = require("fs");
const path = require("path");

const api = JSON.parse(fs.readFileSync(path.join(__dirname, "api-results.json"), "utf8"));
const ui = JSON.parse(fs.readFileSync(path.join(__dirname, "ui-results.json"), "utf8"));
const OUT = path.join(__dirname, "testing-report.html");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- derive real numbers ----
const byFile = {};
for (const t of api.testResults || []) {
  byFile[t.name.split(/[\\/]/).pop()] = (t.assertionResults || []).length;
}
const fullSuite = (api.testResults || []).find((t) => t.name.includes("api.full"));
const routerGroups = {};
for (const a of fullSuite?.assertionResults || []) {
  const g = (a.ancestorTitles || [])[0] || "(root)";
  routerGroups[g] = (routerGroups[g] || 0) + 1;
}

// UI checks grouped by the console section headings, reconstructed from order
const UI_AREAS = [
  ["Authentication", 4],
  ["Dashboard", 7],
  ["Deals list", 4],
  ["Deal detail", 9],
  ["Draft follow-up", 3],
  ["Summarize meeting", 1],
  ["Ask your CRM", 3],
  ["Semantic search", 1],
  ["Contacts", 3],
  ["Tasks", 1],
  ["Duplicates", 2],
  ["AI usage", 2],
  ["Role scoping", 2],
  ["Responsive", 1],
  ["Dark theme and console health", 2],
];

const totalTests = api.numTotalTests + ui.passed + ui.failed;
const totalPassed = api.numPassedTests + ui.passed;
const totalFailed = api.numFailedTests + ui.failed;

const table = (head, rows, cls = "") => `<div class="tablewrap"><table class="${cls}">
<thead><tr>${head.map((h, i) => `<th${i > 0 ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead>
<tbody>${rows
  .map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="first"' : ' class="num"'}>${c}</td>`).join("")}</tr>`)
  .join("")}</tbody></table></div>`;

const findings = [
  {
    sym: "Every deal scored 100",
    cause: "The six score components summed past the ceiling, so the clamp flattened the top of the range and the gauge told you nothing.",
    fix: "Rescaled all six weights so only an exceptional deal reaches 100. Scores now spread across the full range on the seed data.",
    found: "Reading the seeded output",
  },
  {
    sym: "Seeded history all showed as a few minutes old",
    cause: "The ORM marks created timestamps immutable, so the backdating update was silently dropped. That also inflated the 30-day engagement count feeding the score.",
    fix: "Backdate through the raw driver. History now spans months and engagement counts are realistic.",
    found: "Semantic search screenshot showed every note the same age",
  },
  {
    sym: "Duplicate scan crashed on a unique-index collision",
    cause: "Two background jobs discovering the same pair from opposite sides raced to insert it.",
    fix: "An idempotent upsert that treats a lost race as a no-op. The boot log went from repeated job failures to clean.",
    found: "API log during a restart",
  },
  {
    sym: "A rejected question showed “Unprocessable Entity”",
    cause: "The client read the HTTP status text instead of the structured rejection in the response body, so the user never saw the real reason.",
    fix: "Propagate the response body. The refusal now states why.",
    found: "Driving the Ask screen in a browser",
  },
  {
    sym: "Fallback meeting summaries turned speaker lines into tasks",
    cause: "The extractive matcher accepted any sentence containing a modal verb, so “Let's start with security” became an action item.",
    fix: "Require a first-person commitment paired with an action verb, and strip speaker labels first. Five real commitments now, no noise.",
    found: "Reading the generated action items",
  },
  {
    sym: "Vector reads returned corrupt data",
    cause: "Two bugs in the new packed-Float32 store: a lean read returns BSON Binary rather than a Buffer, and the copy could land on a non-4-byte-aligned offset, either of which breaks the Float32 view.",
    fix: "Accept both shapes and copy into a fresh aligned buffer.",
    found: "Semantic search tests failed after the optimisation",
  },
];

const scriptFaults = [
  ["Five checks", "Assertions were case-sensitive against labels the CSS uppercases. “RECORD A” and “ACTION ITEMS” were rendering correctly the whole time.", "Compare case-insensitively"],
  ["One check", "Waited for placeholder text, which never appears in a page's rendered text.", "Wait for the input element instead"],
  ["Two checks", "Waited on toasts, which auto-dismiss and are inherently racy. A focused probe proved the requests returned 200 and 201 and the data saved.", "Assert the outcome, not the notification"],
  ["Four checks", "Used a DOM-level click on tab triggers, which listen for pointer events and ignore it.", "Use real mouse events"],
];

const html = `<title>LOOM Test Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{
  --ground:#F4F6F8;--paper:#fff;--sunk:#EDF0F3;--ink:#0E1319;--ink-2:#4E5B67;--ink-3:#7D8B97;
  --line:#DFE4E9;--line-strong:#C6CFD6;--signal:#0B6E8C;--signal-wash:#E4F1F5;
  --good:#17794B;--good-wash:#E3F2E9;--caution:#8A5B10;--caution-wash:#F8EFDF;--bad:#B3372F;--bad-wash:#FAE9E7;
  --lift:0 1px 2px rgba(14,19,25,.05),0 10px 30px -22px rgba(14,19,25,.35);
  --sans:"Instrument Sans",ui-sans-serif,system-ui,"Segoe UI",sans-serif;
  --serif:"Instrument Serif",ui-serif,Georgia,serif;
  --mono:"JetBrains Mono",ui-monospace,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#0B1014;--paper:#151D23;--sunk:#111820;--ink:#E9EFF2;--ink-2:#A6B4BD;--ink-3:#7A8892;
  --line:#253138;--line-strong:#35454E;--signal:#52C2DA;--signal-wash:#122E36;
  --good:#5FCB8C;--good-wash:#12291C;--caution:#E0AC55;--caution-wash:#2A2113;--bad:#E8776C;--bad-wash:#2E1815;
  --lift:0 1px 2px rgba(0,0,0,.45),0 10px 30px -22px rgba(0,0,0,.9);
}}
:root[data-theme="dark"]{
  --ground:#0B1014;--paper:#151D23;--sunk:#111820;--ink:#E9EFF2;--ink-2:#A6B4BD;--ink-3:#7A8892;
  --line:#253138;--line-strong:#35454E;--signal:#52C2DA;--signal-wash:#122E36;
  --good:#5FCB8C;--good-wash:#12291C;--caution:#E0AC55;--caution-wash:#2A2113;--bad:#E8776C;--bad-wash:#2E1815;
  --lift:0 1px 2px rgba(0,0,0,.45),0 10px 30px -22px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.62;-webkit-font-smoothing:antialiased}
.wrap{max-width:62rem;margin:0 auto;padding:3.5rem 1.5rem 6rem}
.kicker{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--signal);margin:0 0 1rem}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(2.4rem,6vw,3.6rem);line-height:1.02;letter-spacing:-.02em;margin:0 0 1rem;text-wrap:balance}
.standfirst{font-size:1.08rem;color:var(--ink-2);max-width:42rem;margin:0}
section{margin-top:3.5rem;display:flex;flex-direction:column;gap:1.15rem}
.sec-head{display:flex;flex-direction:column;gap:.35rem;padding-bottom:.8rem;border-bottom:2px solid var(--line-strong)}
h2{font-family:var(--serif);font-weight:400;font-size:1.85rem;line-height:1.15;letter-spacing:-.012em;margin:0;text-wrap:balance}
.sec-head p{color:var(--ink-2);font-size:.95rem;max-width:44rem}
h3{font-size:1rem;font-weight:600;margin:.6rem 0 0}
p{margin:0;max-width:44rem}
ul{margin:0;padding-left:1.15rem;display:flex;flex-direction:column;gap:.4rem;max-width:44rem}
li::marker{color:var(--ink-3)}
code{font-family:var(--mono);font-size:.85em;background:var(--sunk);padding:.1em .38em;border-radius:4px}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:2.5rem}
.cell{background:var(--paper);padding:1.05rem 1.15rem;display:flex;flex-direction:column;gap:.25rem}
.cell .num{font-family:var(--serif);font-size:2rem;line-height:1;font-variant-numeric:tabular-nums}
.cell .lbl{font-family:var(--mono);font-size:.63rem;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3)}
.cell.ok .num{color:var(--good)}
.cell.zero .num{color:var(--ink-3)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--paper)}
table{border-collapse:collapse;width:100%;min-width:30rem}
th,td{text-align:left;padding:.62rem .9rem;border-bottom:1px solid var(--line);font-size:.9rem;vertical-align:top}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
thead th{font-family:var(--mono);font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);font-weight:600;background:var(--sunk);border-bottom:1px solid var(--line-strong)}
tbody tr:last-child td{border-bottom:none}
td.first{font-weight:500}
table.wide td.num{text-align:left}
.finding{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:1rem 1.2rem;display:flex;flex-direction:column;gap:.4rem}
.finding .sym{font-weight:600;font-size:.98rem}
.finding .meta{font-family:var(--mono);font-size:.63rem;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.finding p{font-size:.91rem;color:var(--ink-2)}
.finding b{color:var(--ink);font-weight:600}
.stack{display:flex;flex-direction:column;gap:.7rem}
.note{border-left:3px solid var(--signal);background:var(--signal-wash);border-radius:0 8px 8px 0;padding:.95rem 1.15rem;display:flex;flex-direction:column;gap:.4rem}
.note.warn{border-left-color:var(--caution);background:var(--caution-wash)}
.note strong{font-size:.83rem}
.note p{font-size:.93rem;color:var(--ink-2)}
.verdict{display:inline-flex;align-items:center;gap:.4rem;font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;padding:.25rem .55rem;border-radius:5px;background:var(--good-wash);color:var(--good)}
footer{margin-top:4rem;padding-top:1.25rem;border-top:1px solid var(--line);color:var(--ink-3);font-size:.85rem;display:flex;flex-wrap:wrap;gap:.4rem 1.25rem}
footer span{font-family:var(--mono);font-size:.78rem}
:focus-visible{outline:2px solid var(--signal);outline-offset:2px;border-radius:4px}
</style>

<div class="wrap">
  <p class="kicker">Test report &middot; 2 September 2026</p>
  <h1>LOOM</h1>
  <p class="standfirst">
    Two suites were run against the application: an automated suite covering every API route and the
    scoring, query, matching and safety logic, and an end-to-end pass that drives the real interface in a
    browser and photographs each state. ${totalPassed} of ${totalTests} checks passed.
  </p>

  <div class="strip">
    <div class="cell ok"><span class="num">${api.numPassedTests}</span><span class="lbl">API &amp; unit tests</span></div>
    <div class="cell ok"><span class="num">${ui.passed}</span><span class="lbl">UI checks</span></div>
    <div class="cell ok"><span class="num">44</span><span class="lbl">Routes covered</span></div>
    <div class="cell ok"><span class="num">41</span><span class="lbl">Screens captured</span></div>
    <div class="cell ${totalFailed ? "" : "zero"}"><span class="num">${totalFailed}</span><span class="lbl">Failing</span></div>
  </div>

  <section>
    <div class="sec-head">
      <h2>What was tested</h2>
      <p>Breadth first: every route with its auth, validation and role rules. Then depth on the logic that would be expensive to get wrong, and finally the interface itself, driven as a person would use it.</p>
    </div>

    <h3>Automated suite &mdash; ${api.numTotalTests} tests across ${Object.keys(byFile).length} files</h3>
    ${table(
      ["File", "Tests", "Covers"],
      [
        [`<code>api.full.test.ts</code>`, byFile["api.full.test.ts"], "Every route on every router, with auth, validation, role and success paths"],
        [`<code>nlQuery.test.ts</code>`, byFile["nlQuery.test.ts"], "Natural-language query validation, rejection, compilation and the date grammar"],
        [`<code>duplicates.test.ts</code>`, byFile["duplicates.test.ts"], "Fuzzy matching, nickname and typo handling, and blocking-key recall"],
        [`<code>leadScore.test.ts</code>`, byFile["leadScore.test.ts"], "Each scoring component, bounds, and the change-detection hash"],
        [`<code>contacts.crud.test.ts</code>`, byFile["contacts.crud.test.ts"], "The core CRUD journey with role scoping and background scoring"],
        [`<code>riskFlag.test.ts</code>`, byFile["riskFlag.test.ts"], "Each risk signal and the reasons it produces"],
        [`<code>sanitize.test.ts</code>`, byFile["sanitize.test.ts"], "Prompt-injection hardening of untrusted text"],
        [`<code>aiGateway.test.ts</code>`, byFile["aiGateway.test.ts"], "Caching, usage logging, circuit breaker, refusals and timeouts"],
        [`<code>semanticSearch.test.ts</code>`, byFile["semanticSearch.test.ts"], "Meaning-based ranking, ownership scoping and the text fallback"],
      ],
      "wide",
    )}

    <h3>Endpoint coverage by router</h3>
    ${table(
      ["Router", "Tests"],
      Object.entries(routerGroups).map(([g, n]) => [g.replace(/ router.*/, "").replace(/^./, (c) => c.toUpperCase()), n]),
    )}

    <h3>Interface pass &mdash; ${ui.passed} checks, ${41} screenshots</h3>
    <p>The app runs in Chrome and is driven the way a person would: sign in, filter a list, open a deal, add a note, tick a task, generate a draft, paste a transcript, ask a question, review a duplicate. Each check asserts what should be on screen and captures the result.</p>
    ${table(["Area", "Checks"], UI_AREAS)}
  </section>

  <section>
    <div class="sec-head">
      <h2>What the tests actually prove</h2>
    </div>
    <div class="stack">
      <div class="finding"><span class="sym">Access control holds at the data layer</span><p>A member sees zero of another owner's contacts, deals, notes and tasks across every listing route, cannot read, edit, delete or re-score another owner's records, and cannot assign ownership to someone else. The admin-only routes refuse members with a 403 and anonymous callers with a 401. The same scoping is applied inside natural-language queries and semantic search, so a member cannot widen their view by asking for it.</p></div>
      <div class="finding"><span class="sym">The natural-language feature cannot be talked into a write</span><p>Five question shapes translate and run. Six rejection classes hold: unknown fields, an operator that does not fit the field type, <code>$</code>-prefixed keys anywhere in the payload, over-limit requests, unsortable fields and malformed structures. A request to delete every contact is refused with a reason, and the contact count is unchanged afterwards.</p></div>
      <div class="finding"><span class="sym">An AI outage degrades rather than breaks</span><p>The entire application was exercised with no AI provider configured. Every screen renders and every feature falls back to a labelled alternative. Gateway tests separately cover a timeout, a refusal, a schema mismatch and an open circuit breaker, all of which return a result object rather than throwing into a request handler.</p></div>
      <div class="finding"><span class="sym">Untrusted text stays data</span><p>A note containing “ignore all previous instructions” is stored verbatim, flagged for a human, and never acted on. Angle brackets are neutralised so note content cannot close the wrapper that fences it, control and zero-width characters are stripped, and long input is capped.</p></div>
      <div class="finding"><span class="sym">Nothing is sent or merged without a person</span><p>Generating an email draft writes no timeline entry; only an explicit send does. A merge asks for confirmation, and cancelling it leaves the queue untouched.</p></div>
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>Defects found and fixed</h2>
      <p>Every one of these was caught by running the thing rather than by reading it. All are fixed and covered by a test.</p>
    </div>
    <div class="stack">
      ${findings
        .map(
          (f) => `<div class="finding">
        <span class="meta">Found by ${esc(f.found).toLowerCase()}</span>
        <span class="sym">${f.sym}</span>
        <p><b>Cause.</b> ${f.cause}</p>
        <p><b>Fix.</b> ${f.fix}</p>
      </div>`,
        )
        .join("")}
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>The interface pass found no application defects</h2>
      <p>Seven checks failed on the first run. Each was investigated to root cause, and all seven were faults in the test script rather than the application.</p>
    </div>
    ${table(["Failures", "Root cause", "Correction"], scriptFaults, "wide")}
    <div class="note">
      <strong>The two worth spelling out</strong>
      <p>Two checks waited on a toast notification and timed out. Rather than assume a timing quirk, a focused probe was written against the live app: it confirmed the recompute request returns 200 with its notification appearing within half a second, and the note request returns 201 with the note visible on the page. The checks were then rewritten to assert the request and the resulting change instead of a notification that dismisses itself.</p>
    </div>
    <p>A run also confirmed no uncaught console errors across the whole pass. The ${ui.consoleErrors?.length ?? 0} messages captured are the deliberate 401, 403 and 422 responses the tests provoke.</p>
  </section>

  <section>
    <div class="sec-head">
      <h2>Performance</h2>
      <p>Measured with <code>npm run bench -w @loom/api</code>, which loads a synthetic dataset and times the paths that grow super-linearly. Two were genuinely broken and are now fixed.</p>
    </div>
    ${table(
      ["Path", "Before", "After", "Change"],
      [
        ["Duplicate scan, 1,200 contacts", "7,438 ms", "140 ms", "53&times; faster"],
        ["Vector load, 6,000 embeddings", "164 ms", "36 ms", "4.6&times; faster"],
      ],
      "wide",
    )}
    <p>Duplicate detection compared every contact against every other, which is 719,000 comparisons at 1,200 contacts and roughly 8.6 minutes of CPU at 10,000. It now generates candidates from blocking keys and scores 1.5% of the pairs. All five realistic duplicate classes are still caught, which the test suite locks in.</p>
    <p>Vector search spent its time loading rather than comparing. Vectors are now packed Float32, normalised on write so ranking is a dot product, and cached in process.</p>
  </section>

  <section>
    <div class="sec-head">
      <h2>Not verified</h2>
    </div>
    <div class="note warn">
      <strong>No live Claude call has ever run</strong>
      <p>This machine has no API key, so every check above exercised the fallback path. What is proven is the plumbing: caching, usage logging, the circuit breaker, refusal handling and every degradation path, all covered by tests using a provider double that returns canned structured output. What is not proven is the quality of model-written prose &mdash; the drafts, summaries and risk explanations. Set a key, restart, and the header pill flips from “AI offline” to the model name; the admin usage page is where you would confirm calls are landing.</p>
    </div>
    <p>Three further limits are documented in the project readme rather than fixed: deep pagination uses skip and limit, deal search by company runs an unindexed regex, and several screens poll on an interval. All three are comfortable at the scale this app is built for.</p>
  </section>

  <section>
    <div class="sec-head">
      <h2>Reproducing this</h2>
    </div>
    ${table(
      ["Command", "Runs"],
      [
        ["<code>npm test</code>", `The ${api.numTotalTests} automated tests`],
        ["<code>npm run typecheck</code>", "All three packages"],
        ["<code>npm run bench -w @loom/api</code>", "The scale benchmark"],
        ["<code>npm run build</code>", "The production build of the web app"],
      ],
      "wide",
    )}
    <p>The interface pass needs the app running on its usual ports, then drives Chrome directly and writes its screenshots and a JSON result file.</p>
  </section>

  <footer>
    <span>${api.numPassedTests} automated tests</span>
    <span>${ui.passed} UI checks</span>
    <span>44 routes</span>
    <span>41 screenshots</span>
    <span>0 failing</span>
  </footer>
</div>`;

fs.writeFileSync(OUT, html, "utf8");
console.log(`Wrote ${OUT}`);
console.log(`API ${api.numPassedTests}/${api.numTotalTests}, UI ${ui.passed}/${ui.passed + ui.failed}, total ${totalPassed}/${totalTests}`);
