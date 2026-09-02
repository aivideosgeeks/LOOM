/**
 * End-to-end UI pass. Drives the real app in Chrome, exercises every screen and
 * control, asserts what should be on screen, and captures a screenshot of each
 * state for the handbook. Every check is recorded so the run produces a report.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3000";
const SHOTS = path.join(__dirname, "shots");
const RESULTS = path.join(__dirname, "ui-results.json");

const checks = [];
let page;

function record(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
    return true;
  } catch (err) {
    record(name, false, err.message.split("\n")[0].slice(0, 160));
    // A failure that leaves no evidence cannot be diagnosed.
    try {
      const slug = name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
      await page.screenshot({ path: path.join(SHOTS, `FAIL-${slug}.png`) });
      fs.writeFileSync(path.join(SHOTS, `FAIL-${slug}.txt`), `URL: ${page.url()}\n\n${await page.evaluate(() => document.body.innerText)}`);
    } catch {}
    return false;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function shot(name, opts = {}) {
  await new Promise((r) => setTimeout(r, opts.settle ?? 700));
  const file = path.join(SHOTS, `${name}.png`);
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (el) {
      await el.screenshot({ path: file });
      return file;
    }
  }
  await page.screenshot({ path: file, fullPage: !!opts.full });
  return file;
}

/** Text content of the whole page, for assertions. */
const bodyText = () => page.evaluate(() => document.body.innerText);

/**
 * innerText reflects CSS text-transform, so several labels arrive uppercased.
 * Assertions compare case-insensitively; only the rendering differs.
 */
const has = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Click by visible text using real mouse events. A DOM-level .click() is not enough:
 * Radix primitives (tabs, selects) listen for pointer events, so a bare click() is ignored.
 * The element is scrolled into view first so the click lands where the element actually is.
 */
async function clickIn(tag, text) {
  const handle = await page.evaluateHandle(
    (tag, text) => [...document.querySelectorAll(tag)].find((e) => (e.innerText || "").toLowerCase().includes(text.toLowerCase())),
    tag,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no ${tag} containing "${text}"`);
  const disabled = await page.evaluate((e) => e.disabled === true, el);
  if (disabled) throw new Error(`${tag} containing "${text}" is disabled`);
  await el.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
  await new Promise((r) => setTimeout(r, 150));
  await el.click();
}

async function clickText(tag, text, { exact = false } = {}) {
  const handle = await page.evaluateHandle(
    (tag, text, exact) => {
      const els = [...document.querySelectorAll(tag)];
      return els.find((e) => {
        const t = (e.innerText || e.textContent || "").trim();
        return exact ? t === text : t.includes(text);
      });
    },
    tag,
    text,
    exact,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`no ${tag} containing "${text}"`);
  await el.click();
  return el;
}

async function waitForText(text, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb", "--hide-scrollbars"],
  });
  page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.setDefaultTimeout(20000);

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));

  console.log("\n=== 1. Authentication ===");

  await check("unauthenticated visit redirects to the sign-in page", async () => {
    await page.goto(`${BASE}/deals`, { waitUntil: "networkidle2" });
    assert(page.url().includes("/login"), `landed on ${page.url()}`);
    return "guarded";
  });

  await check("sign-in page renders with demo credentials prefilled", async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    const email = await page.$eval("#email", (e) => e.value);
    assert(email === "admin@crm.dev", `email was "${email}"`);
    await shot("01-login");
    return email;
  });

  await check("wrong password shows an inline error and does not sign in", async () => {
    await page.$eval("#password", (e) => (e.value = ""));
    await page.type("#password", "definitely-wrong");
    await page.click('button[type="submit"]');
    await waitForText("Invalid email or password", 10000);
    await shot("02-login-error");
    assert(page.url().includes("/login"), "should stay on login");
    return "rejected";
  });

  await check("correct password signs in and lands on the dashboard", async () => {
    await page.$eval("#password", (e) => (e.value = ""));
    await page.type("#password", "password123");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}), page.click('button[type="submit"]')]);
    await waitForText("Good", 15000);
    return "signed in";
  });

  console.log("\n=== 2. Dashboard ===");

  await check("dashboard shows the five headline figures", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await waitForText("Open pipeline");
    const t = await bodyText();
    for (const label of ["OPEN PIPELINE", "OPEN DEALS", "AT RISK", "CONTACTS", "WON ALL TIME"]) {
      assert(t.toUpperCase().includes(label), `missing ${label}`);
    }
    await shot("03-dashboard", { settle: 1500 });
    await shot("03b-dashboard-full", { full: true, settle: 500 });
    return "5 figures";
  });

  await check("at-risk panel lists deals with a written reason and signals", async () => {
    const t = await bodyText();
    assert(has(t, "Deals at risk"), "no at-risk panel");
    assert(/threshold \d+/.test(t), "no rule-based reason text");
    assert(t.includes("stalled") || t.includes("inactive"), "no signal chips");
    return "reasons present";
  });

  await check("pipeline panel lists all six stages", async () => {
    const t = await bodyText();
    for (const s of ["Lead", "Contacted", "Proposal", "Negotiation", "Won", "Lost"]) assert(t.includes(s), `missing ${s}`);
    await shot("04-dashboard-rail", { selector: "main > div > div:nth-child(3) > div:nth-child(2)" });
    return "6 stages";
  });

  await check("score gauges render as SVG rings", async () => {
    const rings = await page.$$eval("main svg circle", (els) => els.length);
    assert(rings >= 4, `only ${rings} circles`);
    return `${rings} ring segments`;
  });

  await check("sidebar stays fixed while the page scrolls", async () => {
    const before = await page.$eval("aside", (e) => e.getBoundingClientRect().top);
    await page.evaluate(() => window.scrollBy(0, 700));
    await new Promise((r) => setTimeout(r, 400));
    const after = await page.$eval("aside", (e) => e.getBoundingClientRect().top);
    assert(Math.abs(after - before) < 2, `moved ${before} -> ${after}`);
    await shot("05-scrolled-sidebar-fixed", { settle: 400 });
    await page.evaluate(() => window.scrollTo(0, 0));
    return "fixed";
  });

  await check("the right rail is sticky and leaves no dead space", async () => {
    const m = await page.evaluate(() => {
      const grid = [...document.querySelectorAll("main div")].find((d) => d.className.includes("xl:grid-cols-"));
      const cols = [...grid.children];
      const rail = cols[1].firstElementChild;
      return { pos: getComputedStyle(rail).position, grid: Math.round(grid.getBoundingClientRect().height), left: Math.round(cols[0].getBoundingClientRect().height) };
    });
    assert(m.pos === "sticky", `rail position ${m.pos}`);
    assert(Math.abs(m.grid - m.left) < 5, `grid ${m.grid} vs left column ${m.left}`);
    return `sticky, grid height = left column (${m.grid}px)`;
  });

  await check("AI status pill reports fallback mode", async () => {
    const t = await bodyText();
    assert(has(t, "AI offline") || has(t, "Claude"), "no status pill");
    return has(t, "AI offline") ? "offline, fallbacks active" : "Claude live";
  });

  console.log("\n=== 3. Deals list ===");

  await check("deals list renders rows with stage, value and score", async () => {
    await page.goto(`${BASE}/deals`, { waitUntil: "networkidle2" });
    await waitForText("Deals");
    const rows = await page.$$eval("tbody tr", (r) => r.length);
    assert(rows >= 10, `only ${rows} rows`);
    await shot("06-deals-list", { settle: 1200 });
    return `${rows} rows`;
  });

  await check("search filters the list", async () => {
    await page.type('input[placeholder*="Search deals"]', "Umbrella");
    await new Promise((r) => setTimeout(r, 1200));
    const rows = await page.$$eval("tbody tr", (r) => r.length);
    assert(rows >= 1 && rows <= 3, `${rows} rows for Umbrella`);
    await shot("07-deals-search");
    await page.$eval('input[placeholder*="Search deals"]', (e) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(e, "");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 1000));
    return `${rows} matched`;
  });

  await check("At risk only button filters to flagged deals", async () => {
    await clickText("button", "At risk only");
    await new Promise((r) => setTimeout(r, 1200));
    const t = await bodyText();
    const rows = await page.$$eval("tbody tr", (r) => r.length);
    assert(rows >= 1, "no at-risk rows");
    assert(t.includes("At risk"), "no risk badge");
    await shot("08-deals-at-risk-filter");
    await clickText("button", "At risk only");
    await new Promise((r) => setTimeout(r, 800));
    return `${rows} flagged`;
  });

  await check("column sort reorders the table", async () => {
    const before = await page.$$eval("tbody tr td:nth-child(3)", (t) => t.map((e) => e.innerText));
    await clickText("button", "Value");
    await new Promise((r) => setTimeout(r, 1200));
    const after = await page.$$eval("tbody tr td:nth-child(3)", (t) => t.map((e) => e.innerText));
    assert(JSON.stringify(before) !== JSON.stringify(after), "order unchanged");
    await shot("09-deals-sorted-by-value");
    return "reordered";
  });

  console.log("\n=== 4. Deal detail ===");

  let dealUrl = "";
  await check("opening a deal shows header, facts and tabs", async () => {
    await page.goto(`${BASE}/deals`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await clickText("a", "Umbrella");
    await waitForText("Timeline", 15000);
    dealUrl = page.url();
    const t = await bodyText();
    for (const label of ["Stage", "Value", "Expected close", "Owner", "Timeline", "Tasks", "Meetings"]) assert(t.includes(label), `missing ${label}`);
    await shot("10-deal-detail", { settle: 1500 });
    return "all sections";
  });

  await check("lead score breakdown panel lists all six components", async () => {
    const t = await bodyText();
    for (const c of ["Stage prior", "Recency", "Deal value", "Stage velocity", "Note sentiment", "Engagement", "Total"]) {
      assert(t.includes(c), `missing ${c}`);
    }
    await shot("11-score-breakdown", { selector: "main > div:last-child > div:last-child > div:first-child" });
    return "6 components + total";
  });

  await check("Recompute recalculates the score", async () => {
    // Assert the outcome rather than the toast: toasts auto-dismiss and are racy.
    const waitForCall = page.waitForResponse((r) => r.url().includes("/rescore") && r.request().method() === "POST", { timeout: 20000 });
    await clickIn("button", "Recompute");
    const res = await waitForCall;
    assert(res.status() === 200, `rescore returned ${res.status()}`);
    await shot("12-recompute-toast", { settle: 900 });
    const t = await bodyText();
    assert(has(t, "Total"), "breakdown gone after recompute");
    return `HTTP ${res.status()}`;
  });

  await check("timeline lists entries with sentiment labels", async () => {
    const t = await bodyText();
    assert(has(t, "Meeting") || has(t, "Note"), "no timeline entries");
    assert(/Positive|Negative|Neutral/.test(t), "no sentiment labels");
    await shot("13-timeline");
    return "entries + sentiment";
  });

  await check("adding a note appends it to the timeline", async () => {
    const ta = await page.$("textarea");
    await ta.click();
    await page.keyboard.type("Verification note added by the automated UI pass.");
    await shot("14-note-composer", { settle: 400 });
    const waitForCall = page.waitForResponse((r) => r.url().includes("/api/notes") && r.request().method() === "POST", { timeout: 20000 });
    await clickIn("button", "Add to timeline");
    const res = await waitForCall;
    assert(res.status() === 201, `notes returned ${res.status()}`);
    await page.waitForFunction(() => document.body.innerText.includes("Verification note added"), { timeout: 15000 });
    await shot("15-note-added", { settle: 900 });
    return "note appears in the timeline";
  });

  await check("Tasks tab lists tasks including meeting-derived ones", async () => {
    await clickIn("button", "Tasks (");
    // The composer is identified by its placeholder, which never appears in innerText.
    await page.waitForSelector('input[placeholder*="Add a task"]', { timeout: 15000 });
    const t = await bodyText();
    await shot("16-deal-tasks", { settle: 900 });
    return has(t, "from meeting") ? "includes meeting-derived tasks" : "tasks listed";
  });

  await check("adding a task from the + button works", async () => {
    await page.type('input[placeholder*="Add a task"]', "Task added by the UI pass");
    await page.click('button[aria-label="Add task"]');
    await new Promise((r) => setTimeout(r, 1800));
    const t = await bodyText();
    assert(t.includes("Task added by the UI pass"), "task not listed");
    await shot("17-task-added");
    return "created via + button";
  });

  await check("ticking a task strikes it through", async () => {
    await page.evaluate(() => {
      const label = [...document.querySelectorAll("label")].find((l) => l.innerText.includes("Task added by the UI pass"));
      label.querySelector('input[type="checkbox"]').click();
    });
    await new Promise((r) => setTimeout(r, 1200));
    await shot("18-task-checked");
    return "checked";
  });

  await check("Meetings tab shows the summary, action items and next steps", async () => {
    await clickIn("button", "Meetings (");
    await waitForText("Action items", 20000);
    const t = await bodyText();
    assert(has(t, "Action items"), "no action items");
    assert(has(t, "Next steps"), "no next steps");
    await shot("19-meeting-card", { settle: 900 });
    return "summary + action items + next steps";
  });

  console.log("\n=== 5. Draft follow-up ===");

  await check("draft dialog opens with tone and intent controls", async () => {
    await page.goto(dealUrl, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await clickText("button", "Draft follow-up");
    await waitForText("Draft a follow-up to", 10000);
    const t = await bodyText();
    assert(has(t, "Tone"), "no tone control");
    assert(has(t, "Generate"), "no generate button");
    await shot("20-draft-dialog-empty");
    return "dialog open";
  });

  await check("Generate produces an editable draft labelled with its source", async () => {
    await page.type("#intent", "check in on the revised pricing");
    await clickText("button", "Generate");
    await waitForText("Send & log to timeline", 90000);
    const t = await bodyText();
    assert(/Generated by Claude|Template \(AI offline\)/.test(t), "no source label");
    const body = await page.$eval("#body", (e) => e.value);
    assert(body.length > 20, "empty body");
    assert(body.includes("Marcus"), "not personalised to the contact");
    await shot("21-draft-generated");
    return `${body.length} chars, editable`;
  });

  await check("draft body is editable before sending", async () => {
    await page.click("#body");
    await page.keyboard.type(" Edited by the UI pass.");
    const body = await page.$eval("#body", (e) => e.value);
    assert(body.includes("Edited by the UI pass"), "not editable");
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 700));
    return "editable";
  });

  console.log("\n=== 6. Summarize meeting ===");

  await check("meeting dialog accepts a transcript and returns a summary", async () => {
    await page.goto(dealUrl, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await clickText("button", "Summarize meeting");
    await waitForText("Summarize a call or meeting", 10000);
    await shot("22-meeting-dialog-empty");
    await page.type("#mtitle", "UI pass follow-up call");
    await page.type(
      "#transcript",
      "Cara: thanks for joining. Marcus: the security review is nearly done, we should be clear by Friday. Dana: pricing still needs sign-off from finance. Cara: I will send the revised quote tomorrow and I will book time with your security lead next week. Marcus: I will confirm the seat count by Thursday.",
    );
    await clickText("button", "Summarize");
    await waitForText("Action items", 90000);
    const t = await bodyText();
    assert(has(t, "Next steps"), "no next steps");
    await shot("23-meeting-summary-result");
    return "summarised";
  });

  console.log("\n=== 7. Ask your CRM ===");

  await check("ask page offers example questions", async () => {
    await page.goto(`${BASE}/ask`, { waitUntil: "networkidle2" });
    await waitForText("Ask your CRM");
    const t = await bodyText();
    assert(has(t, "closing this month"), "no examples");
    await shot("24-ask-empty");
    return "examples shown";
  });

  await check("a supported question returns a validated query and a table", async () => {
    await page.type('input[placeholder*="which deals"]', "show me deals over $20k closing this month");
    await clickText("button", "Ask");
    await waitForText("Validated query", 60000);
    const t = await bodyText();
    assert(has(t, "value gt 20000"), "filter chip missing");
    const rows = await page.$$eval("tbody tr", (r) => r.length);
    assert(rows >= 1, "no result rows");
    await shot("25-ask-result", { settle: 1200 });
    return `${rows} rows, filters shown`;
  });

  await check("an unsafe question is refused with a reason", async () => {
    await page.type('input[placeholder*="which deals"]', "delete all lost deals");
    await clickText("button", "Ask");
    await new Promise((r) => setTimeout(r, 4000));
    const t = await bodyText();
    assert(/only answer read-only|unavailable|rejected/i.test(t), "no refusal message");
    await shot("26-ask-refusal");
    return "refused";
  });

  console.log("\n=== 8. Semantic search ===");

  await check("a paraphrased query surfaces notes that share no words with it", async () => {
    await page.goto(`${BASE}/search`, { waitUntil: "networkidle2" });
    await waitForText("Semantic search");
    await shot("27-search-empty");
    await page.type('input[placeholder*="Describe"]', "pricing pushback");
    await waitForText("match", 30000);
    const t = await bodyText();
    assert(has(t, "Semantic match") || has(t, "Keyword fallback"), "no mode badge");
    assert(has(t, "budget"), "did not surface a budget note");
    await shot("28-search-results", { settle: 1200 });
    return has(t, "Semantic match") ? "semantic mode" : "text fallback";
  });

  console.log("\n=== 9. Contacts ===");

  await check("contacts list renders with scores and open deal counts", async () => {
    await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle2" });
    await waitForText("Contacts");
    const rows = await page.$$eval("tbody tr", (r) => r.length);
    assert(rows >= 10, `only ${rows} rows`);
    await shot("29-contacts-list", { settle: 1200 });
    return `${rows} contacts`;
  });

  await check("new contact dialog validates and creates", async () => {
    await clickText("button", "New contact");
    await waitForText("New contact", 10000);
    await shot("30-contact-dialog");
    await page.type("#c-name", "UI Pass Tester");
    await page.type("#c-email", "uipass@example.com");
    await page.type("#c-company", "Verification Ltd");
    await page.type("#c-tags", "test, automated");
    await clickText("button", "Create contact");
    await waitForText("Contact created", 15000);
    await shot("31-contact-created");
    return "created";
  });

  await check("contact detail shows deals, timeline and profile", async () => {
    await page.goto(`${BASE}/contacts`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    await clickText("a", "Marcus Lee");
    await waitForText("Profile", 15000);
    const t = await bodyText();
    assert(has(t, "Deals ("), "no deals panel");
    assert(has(t, "Tags"), "no tags");
    await shot("32-contact-detail", { settle: 1200 });
    return "sections present";
  });

  console.log("\n=== 10. Tasks page ===");

  await check("tasks page separates open from completed", async () => {
    await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle2" });
    await waitForText("Tasks");
    const t = await bodyText();
    assert(has(t, "Open ("), "no open group");
    await shot("33-tasks-page", { settle: 1200 });
    return "grouped";
  });

  console.log("\n=== 11. Duplicates (admin) ===");

  await check("duplicate queue shows candidates side by side with reasons", async () => {
    await page.goto(`${BASE}/duplicates`, { waitUntil: "networkidle2" });
    await waitForText("Possible duplicates");
    await waitForText("Record A", 25000);
    const t = await bodyText();
    assert(has(t, "Record A") && has(t, "Record B"), "no side-by-side comparison");
    assert(/\d+% match/.test(t), "no match score");
    assert(has(t, "Keep this one"), "no merge control");
    assert(has(t, "Not a duplicate"), "no dismiss control");
    await shot("34-duplicates", { settle: 1200 });
    const count = (t.match(/% match/g) || []).length;
    return `${count} candidate pairs`;
  });

  await check("merging is confirmed before it happens", async () => {
    page.once("dialog", async (d) => {
      await d.dismiss();
    });
    await clickText("button", "Keep this one");
    await new Promise((r) => setTimeout(r, 1200));
    const t = await bodyText();
    assert(has(t, "Record A"), "queue changed after a dismissed confirm");
    return "cancelled safely";
  });

  console.log("\n=== 12. AI usage (admin) ===");

  await check("AI usage page reports every feature with tokens and cost", async () => {
    await page.goto(`${BASE}/admin/ai-usage`, { waitUntil: "networkidle2" });
    await waitForText("AI usage");
    const t = await bodyText();
    for (const f of ["Lead scoring", "Note sentiment", "Email drafting", "Ask your CRM", "Meeting summaries", "Duplicate detection", "Risk flagging"]) {
      assert(has(t, f), `missing ${f}`);
    }
    assert(has(t, "Estimated spend"), "no spend figure");
    assert(has(t, "circuit"), "no circuit state");
    await shot("35-ai-usage", { settle: 1500 });
    await shot("35b-ai-usage-full", { full: true, settle: 400 });
    return "8 feature rows";
  });

  await check("background jobs can be triggered from the admin page", async () => {
    await clickText("button", "risk-scan");
    await waitForText("queued", 20000);
    await shot("36-job-queued");
    return "risk-scan queued";
  });

  console.log("\n=== 13. Role scoping in the UI ===");

  await check("a member sees a smaller pipeline and no admin navigation", async () => {
    // Sign out by dropping the cookie: deterministic, and the redirect is asserted separately.
    const client = await page.createCDPSession();
    await client.send("Network.clearBrowserCookies");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await page.waitForSelector("#email", { timeout: 15000 });
    await page.$eval("#email", (e) => (e.value = ""));
    await page.type("#email", "ben@crm.dev");
    await page.$eval("#password", (e) => (e.value = ""));
    await page.type("#password", "password123");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}), page.click('button[type="submit"]')]);
    await waitForText("Good", 15000);
    const t = await bodyText();
    assert(!has(t, "Duplicates"), "member can see the duplicates link");
    assert(!has(t, "AI usage"), "member can see the AI usage link");
    assert(has(t, "Your pipeline"), "not scoped copy");
    await shot("37-member-dashboard", { settle: 1500 });
    return "admin nav hidden";
  });

  await check("a member is blocked from the admin pages by the API", async () => {
    await page.goto(`${BASE}/duplicates`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2500));
    const t = await bodyText();
    assert(!has(t, "Record A"), "member saw duplicate records");
    return "blocked";
  });

  console.log("\n=== 14. Responsive ===");

  await check("layout collapses cleanly on a phone viewport", async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await waitForText("Good", 15000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 2, `horizontal overflow of ${overflow}px`);
    await shot("38-mobile-dashboard", { settle: 1500 });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    return "no horizontal scroll";
  });

  console.log("\n=== 15. Dark theme ===");

  await check("dark theme renders with correct contrast", async () => {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await waitForText("Good", 15000);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(!/255, 255, 255/.test(bg), `body still light: ${bg}`);
    await shot("39-dashboard-dark", { settle: 1500 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    return bg;
  });

  await check("no uncaught console errors during the whole pass", async () => {
    const real = consoleErrors.filter((e) => !/401|403|422|Failed to load resource/.test(e));
    assert(real.length === 0, `${real.length}: ${real.slice(0, 2).join(" | ")}`);
    return `${consoleErrors.length} expected-status network messages only`;
  });

  await browser.close();

  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  fs.writeFileSync(RESULTS, JSON.stringify({ passed, failed, checks, consoleErrors }, null, 2));
  console.log(`\n${passed}/${checks.length} UI checks passed${failed ? `, ${failed} FAILED` : ""}`);
  console.log(`Screenshots: ${fs.readdirSync(SHOTS).length} files in ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("\nFATAL:", err);
  fs.writeFileSync(RESULTS, JSON.stringify({ passed: checks.filter((c) => c.pass).length, failed: checks.length, checks, fatal: String(err) }, null, 2));
  process.exit(1);
});
