/**
 * Walks the real invitation journey in a browser: an admin invites someone, the
 * invitee opens the link, sets a password, lands inside, and sees only their own data.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3000";
const SHOTS = path.join(__dirname, "shots-accounts");
const checks = [];
let page;

const record = (n, ok, d = "") => {
  checks.push({ n, ok, d });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
};

async function check(name, fn) {
  try {
    const d = await fn();
    record(name, true, typeof d === "string" ? d : "");
  } catch (e) {
    record(name, false, e.message.split("\n")[0].slice(0, 150));
    try {
      await page.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.png`) });
    } catch {}
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const text = () => page.evaluate(() => document.body.innerText);
const has = (h, n) => h.toLowerCase().includes(n.toLowerCase());

async function shot(n, settle = 800) {
  await new Promise((r) => setTimeout(r, settle));
  await page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
}

async function clickIn(tag, t) {
  const h = await page.evaluateHandle(
    (tag, t) => [...document.querySelectorAll(tag)].find((e) => (e.innerText || "").toLowerCase().includes(t.toLowerCase())),
    tag,
    t,
  );
  const el = h.asElement();
  if (!el) throw new Error(`no ${tag} containing "${t}"`);
  await el.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
  await new Promise((r) => setTimeout(r, 120));
  await el.click();
}

const waitFor = (t, ms = 15000) =>
  page.waitForFunction((s) => document.body.innerText.toLowerCase().includes(s.toLowerCase()), { timeout: ms }, t);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb", "--hide-scrollbars"],
  });
  page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.setDefaultTimeout(20000);

  console.log("\n=== Admin invites a colleague ===");

  await check("admin signs in and reaches the Team screen", async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await page.$eval("#password", (e) => (e.value = ""));
    await page.type("#password", "password123");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}), page.click('button[type="submit"]')]);
    await waitFor("Good");
    await page.goto(`${BASE}/admin/team`, { waitUntil: "networkidle2" });
    await waitFor("Invite someone");
    const t = await text();
    assert(has(t, "People ("), "no people list");
    await shot("40-team-page", 1400);
    return "team screen renders";
  });

  let inviteLink = "";
  await check("inviting produces a one-time link", async () => {
    await page.type("#invite-email", "newcolleague@company.com");
    await page.type("#invite-name", "Nadia Colleague");
    await clickIn("button", "Send invite");
    await waitFor("/invite/", 20000);
    inviteLink = await page.evaluate(() => {
      const code = [...document.querySelectorAll("code")].find((c) => c.innerText.includes("/invite/"));
      return code ? code.innerText.trim() : "";
    });
    assert(/\/invite\/[A-Za-z0-9_-]{20,}/.test(inviteLink), `link looked like "${inviteLink}"`);
    await shot("41-invite-created", 1000);
    return inviteLink.replace(/^.*\/invite\//, "/invite/…").slice(0, 24);
  });

  await check("the invitation appears in the pending list", async () => {
    await waitFor("Pending invitations");
    const t = await text();
    assert(has(t, "newcolleague@company.com"), "invitee not listed");
    assert(has(t, "Resend"), "no resend control");
    await shot("42-pending-invites", 900);
    return "listed with resend and revoke";
  });

  console.log("\n=== The invitee joins ===");

  await check("the link is reachable signed out and shows who invited them", async () => {
    const client = await page.createCDPSession();
    await client.send("Network.clearBrowserCookies");
    await page.goto(inviteLink, { waitUntil: "networkidle2" });
    await waitFor("Join the team");
    const shownEmail = await page.$eval("#email", (e) => e.value);
    assert(shownEmail === "newcolleague@company.com", `email field showed "${shownEmail}"`);
    const t = await text();
    assert(has(t, "Alice Admin"), "inviter not named");
    assert(has(t, "member"), "role not shown");
    await shot("43-accept-invite", 1000);
    return "preview correct";
  });

  await check("the password policy is enforced in the form", async () => {
    await page.type("#password", "short1");
    const disabled = await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Create my account"))?.disabled);
    assert(disabled === true, "weak password was accepted by the form");
    await shot("44-password-rules", 600);
    return "submit stays disabled";
  });

  await check("setting a password creates the account and signs them in", async () => {
    await page.$eval("#password", (e) => (e.value = ""));
    await page.type("#password", "joining-crm-2026");
    await clickIn("button", "Create my account");
    await waitFor("Good", 25000);
    const t = await text();
    assert(has(t, "Nadia"), "name not shown in the header");
    assert(has(t, "Your pipeline"), "not scoped as a member");
    assert(!has(t, "AI usage"), "member can see admin navigation");
    await shot("45-invitee-signed-in", 1400);
    return "signed in as a member";
  });

  await check("the used link cannot be used again", async () => {
    const client = await page.createCDPSession();
    await client.send("Network.clearBrowserCookies");
    await page.goto(inviteLink, { waitUntil: "networkidle2" });
    await waitFor("no longer works");
    await shot("46-link-reused", 900);
    return "refused";
  });

  await check("the new account can sign in normally", async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await page.$eval("#email", (e) => (e.value = ""));
    await page.type("#email", "newcolleague@company.com");
    await page.$eval("#password", (e) => (e.value = ""));
    await page.type("#password", "joining-crm-2026");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}), page.click('button[type="submit"]')]);
    await waitFor("Good", 20000);
    return "signs in with the chosen password";
  });

  console.log("\n=== Guards ===");

  await check("a member cannot reach the Team screen's data", async () => {
    await page.goto(`${BASE}/admin/team`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2500));
    const t = await text();
    assert(!has(t, "Pending invitations"), "member saw the invitation queue");
    assert(!has(t, "Invite someone"), "member saw the invite form");
    assert(has(t, "Administrators only"), "no explicit refusal shown");
    return "refused with an explanation";
  });

  await check("setup is closed once the instance has accounts", async () => {
    await page.goto(`${BASE}/setup`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2000));
    assert(!page.url().includes("/setup"), `still on ${page.url()}`);
    return "redirected away";
  });

  await browser.close();
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\n${passed}/${checks.length} account checks passed`);
  fs.writeFileSync(path.join(__dirname, "accounts-results.json"), JSON.stringify({ passed, failed: checks.length - passed, checks }, null, 2));
  process.exit(passed === checks.length ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
