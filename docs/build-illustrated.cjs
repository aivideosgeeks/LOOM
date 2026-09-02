/**
 * Builds the illustrated handbook. Content lives in the SECTIONS structure below and
 * is rendered to a single self-contained HTML file with every screenshot inlined,
 * so the page works offline and inside an artifact sandbox.
 */
const fs = require("fs");
const path = require("path");

const SHOTS = JSON.parse(fs.readFileSync(path.join(__dirname, "shots.json"), "utf8"));
const OUT = path.join(__dirname, "handbook-illustrated.html");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline figure. `crop` trims the fixed sidebar away for close-ups of the main column. */
function fig(id, caption, opts = {}) {
  if (!SHOTS[id]) throw new Error(`missing screenshot: ${id}`);
  const cls = ["shot", opts.wide ? "wide" : "", opts.tall ? "tall" : ""].filter(Boolean).join(" ");
  return `<figure class="${cls}">
  <img src="${SHOTS[id]}" alt="${esc(caption)}" loading="${opts.eager ? "eager" : "lazy"}" decoding="async">
  <figcaption>${caption}</figcaption>
</figure>`;
}

const p = (t) => `<p>${t}</p>`;
const h3 = (t) => `<h3>${t}</h3>`;
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ol = (items) => `<ol class="steps">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const note = (title, body, kind = "") => `<div class="note ${kind}"><strong>${title}</strong><p>${body}</p></div>`;
const code = (t) => `<pre><code>${esc(t)}</code></pre>`;

/** Control reference: every button, field and toggle on a screen. */
function controls(rows) {
  return `<div class="tablewrap"><table class="controls">
<thead><tr><th>Control</th><th>Where</th><th>What it does</th></tr></thead>
<tbody>${rows.map(([c, w, d]) => `<tr><td><span class="ctl">${c}</span></td><td>${w}</td><td>${d}</td></tr>`).join("")}</tbody>
</table></div>`;
}

function table(head, rows) {
  return `<div class="tablewrap"><table>
<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="first"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody>
</table></div>`;
}

const SECTIONS = [
  {
    group: "Start here",
    id: "run",
    title: "Running the app",
    body: [
      p("Nothing needs installing beyond Node. The API starts its own database, its own job queue, and seeds a demo team, so the first run works with no configuration."),
      code(`npm install\nnpm run dev     # app on :3000, API on :4000`),
      p("The first start downloads a database binary and a small embedding model, then caches both. Later starts take a few seconds."),
      note("Demo data is not persistent by default", "Without a database URL the app runs an in-memory database, so restarting clears everything and reseeds. That is deliberate for a trial. See <a href=\"#config\">Configuration</a> to point it at a real database."),
    ],
  },
  {
    id: "signin",
    title: "Signing in",
    body: [
      p("Open <code>localhost:3000</code>. The form is pre-filled with the admin demo account so you can get straight in."),
      fig("01-login", "The sign-in screen, pre-filled with the admin demo account."),
      table(
        ["Account", "Role", "Sees"],
        [
          ["admin@crm.dev", "Admin", "Every record, plus the duplicate queue and AI cost pages"],
          ["ben@crm.dev", "Member", "Only the contacts and deals they own"],
          ["cara@crm.dev", "Member", "Only the contacts and deals they own"],
        ],
      ),
      p("All three use the password <code>password123</code>. A wrong password is refused in place, with the reason under the fields."),
      fig("02-login-error", "A rejected sign-in. The message states what went wrong and the form keeps your input."),
      controls([
        ["Email", "Sign-in form", "The account to sign in as. Must be a valid address."],
        ["Password", "Sign-in form", "At least 6 characters. Rate limited to 20 attempts per 15 minutes per address."],
        ["Sign in", "Sign-in form", "Signs in and returns you to the page you were heading for. Disabled while the request is in flight."],
      ]),
      note("Sessions", "The session is a signed token in a cookie JavaScript cannot read, valid for seven days. Visiting any page while signed out sends you here and returns you afterwards."),
    ],
  },
  {
    id: "tour",
    title: "The interface",
    body: [
      p("Three fixed areas, so nothing moves under you as you scroll."),
      fig("03-dashboard", "The dashboard. Fixed rail on the left, status header across the top, content in the middle."),
      h3("The left rail"),
      p("Always visible and never scrolls away. A sparkle marks the screens where the AI does the work. The <b>Admin</b> group only appears for administrators."),
      h3("The status pill"),
      p("The single source of truth for whether AI is live. Amber with <b>AI offline</b> means the app is running on its built-in fallbacks; green with a model name means Claude is answering. Hover it for the embedding model, vector store and queue in use."),
      h3("Your account"),
      p("The button at the top right shows your initials, name and role. It opens a menu with your email address and <b>Sign out</b>."),
      fig("05-scrolled-sidebar-fixed", "Scrolled down the dashboard. The rail and header hold position while the content moves."),
      h3("Light and dark"),
      p("The app follows your system setting. There is no theme switch to find."),
      fig("39-dashboard-dark", "The same dashboard in dark mode."),
      controls([
        ["Rail links", "Left rail", "Navigate. The active page is marked with a rule and tinted background."],
        ["Sparkle icon", "Left rail", "Marks a screen whose main job is done by the AI."],
        ["Status pill", "Header", "Reports AI, embedding, vector store and queue health. Hover for detail."],
        ["Account button", "Header", "Opens the account menu."],
        ["Sign out", "Account menu", "Ends the session and returns to the sign-in screen."],
      ]),
    ],
  },
  {
    group: "Everyday work",
    id: "dashboard",
    title: "The dashboard",
    body: [
      p("The morning screen. What is at risk, what is strongest, what is due, and what just happened."),
      fig("03b-dashboard-full", "The whole dashboard end to end.", { tall: true }),
      h3("The five figures"),
      p("A connected strip across the top: open pipeline value, open deal count, deals at risk, total contacts, and value won all time. At risk turns red when it is above zero."),
      h3("Deals at risk"),
      p("Each flagged deal shows its stage, value and score, the reason it was flagged, a suggested next step, and the signals that fired. Click any card to open the deal."),
      h3("The right rail"),
      p("Pipeline by stage, tasks due this week, and recent activity. It sticks as you scroll the main column, so it stays useful the whole way down. Bars are sized by value, not deal count."),
      fig("04-dashboard-rail", "The rail: pipeline bars, this week's tasks, and recent activity with sentiment.", { tall: true }),
      controls([
        ["At-risk card", "Deals at risk", "Opens that deal."],
        ["Checkbox", "Due this week", "Marks the task done. The row strikes through and collapses out of the list."],
        ["All deals", "Strongest open deals", "Opens the full deals list."],
        ["Score ring", "Anywhere", "Hover for the full score breakdown."],
        ["Delete icon", "Recent activity", "Removes that timeline entry."],
      ]),
    ],
  },
  {
    id: "deals",
    title: "Deals",
    body: [
      p("Every deal you can see, with its stage, value, score and risk."),
      fig("06-deals-list", "The deals list, sorted by score."),
      h3("Finding a deal"),
      p("Search covers deal titles and the associated contact and company. The stage dropdown narrows to one stage. <b>At risk only</b> is a toggle."),
      fig("07-deals-search", "Searching for Umbrella. The search matches the deal title and the linked contact."),
      fig("08-deals-at-risk-filter", "At risk only. The button turns red while the filter is on; click it again to clear."),
      h3("Sorting"),
      p("Every column header with an arrow sorts. Click once for descending, again for ascending. The arrow shows the direction in use."),
      fig("09-deals-sorted-by-value", "Sorted by value. The header arrow shows which column and direction is active."),
      controls([
        ["Search box", "Toolbar", "Filters by deal title, contact name or company as you type."],
        ["Stage dropdown", "Toolbar", "Shows one stage only, or all."],
        ["At risk only", "Toolbar", "Toggles to just the flagged deals."],
        ["New deal", "Toolbar", "Opens the deal dialog."],
        ["Column headers", "Table", "Sort by title, stage, value, score, close date or last activity."],
        ["Previous / Next", "Below the table", "Pages through results, 25 at a time. Only shown when there is more than one page."],
        ["Deal title", "Table row", "Opens the deal."],
      ]),
    ],
  },
  {
    id: "deal-detail",
    title: "Inside a deal",
    body: [
      fig("10-deal-detail", "A deal. Score ring beside the title, facts across the middle, tabs below, score breakdown on the right."),
      h3("The header"),
      p("Title, score ring and risk badge, then the contact, company and time since last activity. Four actions sit on the right: <b>Draft follow-up</b>, <b>Summarize meeting</b>, <b>Edit</b>, and the delete icon."),
      h3("The facts panel"),
      p("Stage is a dropdown, so you can advance a deal without opening the edit dialog. Changing it logs a line to the timeline, resets the stall clock and re-scores. Below it: value, expected close date, owner, and how long the deal has sat in its stage."),
      h3("The score panel"),
      p("Six components with the input that produced each one, and the total. <b>Recompute</b> forces an immediate recalculation rather than waiting for the background job."),
      fig("11-score-breakdown", "The score breakdown. Every component shows the input behind it, so a number is never unexplained."),
      fig("12-recompute-toast", "Recompute confirms when the score has been recalculated."),
      note("Deleting a deal", "The delete icon asks for confirmation, then removes the deal along with its notes, tasks and meetings.", "warn"),
      controls([
        ["Draft follow-up", "Header", "Opens the email drafting dialog."],
        ["Summarize meeting", "Header", "Opens the transcript dialog."],
        ["Edit", "Header", "Opens the deal dialog to change title, contact, value, stage, close date or owner."],
        ["Delete icon", "Header", "Deletes the deal and everything attached to it, after confirming."],
        ["Stage dropdown", "Facts panel", "Moves the deal to another stage immediately."],
        ["Recompute", "Score panel", "Recalculates the score now."],
        ["Score ring", "Header", "Hover for the breakdown."],
        ["Contact name", "Header", "Opens that contact."],
        ["Tabs", "Middle", "Switch between Timeline, Tasks and Meetings. Each shows its count."],
      ]),
    ],
  },
  {
    id: "timeline",
    title: "Timeline and notes",
    body: [
      p("The record of everything that happened, on both deals and contacts."),
      fig("13-timeline", "The timeline. Each entry carries its kind, author, age and sentiment."),
      h3("Logging an entry"),
      p("Type in the composer, choose the kind, and add it. <code>Ctrl</code>+<code>Enter</code> saves without reaching for the mouse."),
      fig("14-note-composer", "The composer, with the kind selector and the save button."),
      p("Three things then happen in the background, and none of them make you wait: the note is classified for sentiment, embedded for semantic search, and the deal is re-scored and re-checked for risk."),
      fig("15-note-added", "The new note at the top of the timeline, with its sentiment label."),
      h3("Entry kinds"),
      table(
        ["Kind", "Use it for", "Counts as engagement"],
        [
          ["Note", "Anything written down", "Yes"],
          ["Call", "A phone conversation", "Yes"],
          ["Email", "Correspondence, added automatically when you send from the app", "Yes"],
          ["Meeting", "A meeting, added automatically by the summarizer", "Yes"],
          ["System", "Stage changes and merges, written by the app", "No"],
        ],
      ),
      note("The flagged marker", "A note containing instruction-like text is marked flagged. The content is kept and shown in full. The marker only tells you the text looked like an attempt to steer the AI, which the app treats strictly as data."),
      controls([
        ["Composer", "Top of the timeline", "Free text. Ctrl+Enter saves."],
        ["Kind dropdown", "Composer", "Note, Call, Email or Meeting."],
        ["Add to timeline", "Composer", "Saves. Disabled while empty."],
        ["Delete icon", "Each entry", "Removes that entry. System entries cannot be deleted."],
        ["Timestamp", "Each entry", "Hover for the exact date and time."],
        ["Sentiment label", "Each entry", "Hover for the reasoning and whether it came from Claude or the keyword fallback."],
      ]),
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    body: [
      p("Follow-ups, either typed by you or extracted from a meeting transcript."),
      fig("16-deal-tasks", "The Tasks tab on a deal. Items marked from meeting were created by the summarizer."),
      h3("Adding one"),
      p("Type a title, optionally pick a due date, and press the <b>+</b> button or <code>Enter</code>."),
      fig("17-task-added", "A task added from the composer."),
      h3("Completing one"),
      p("Tick the checkbox. The title strikes through immediately, and on the dashboard the row collapses out of the list."),
      fig("18-task-checked", "A completed task. Completed items collapse into their own group."),
      p("Overdue dates turn red, and anything due within two days turns amber. The <b>Tasks</b> screen collects everything across your records."),
      fig("33-tasks-page", "The Tasks screen, with open and completed separated and a link back to the deal or contact."),
      controls([
        ["Title field", "Task composer", "The task text. Enter saves."],
        ["Date field", "Task composer", "Optional due date."],
        ["+ button", "Task composer", "Creates the task. Disabled until there is a title."],
        ["Checkbox", "Each task", "Marks done or not done."],
        ["Completed group", "Below open tasks", "Expands to show finished tasks."],
        ["open deal / open contact", "Tasks screen", "Jumps to the record the task belongs to."],
      ]),
    ],
  },
  {
    group: "The AI features",
    id: "scoring",
    title: "Lead scoring",
    body: [
      p("Every deal carries a score from 0 to 100 estimating how likely it is to close, drawn as a ring so you can read the pipeline without reading numbers."),
      table(
        ["Band", "Ring colour", "Means"],
        [
          ["70 to 100", "Green", "Strong. Push to close."],
          ["40 to 69", "Amber", "Live, needs work."],
          ["Below 40", "Grey", "Cold or stalling."],
        ],
      ),
      p("Hover any ring for the breakdown. Six components add up, each shown with the input that produced it."),
      table(
        ["Component", "Range", "What moves it"],
        [
          ["Stage prior", "0 to 60", "How far along the pipeline the deal is"],
          ["Recency", "0 to 12", "Days since anyone touched it"],
          ["Deal value", "0 to 6", "Size, on a log scale, so big deals do not dominate"],
          ["Stage velocity", "−15 to 6", "Time in the current stage against that stage's threshold"],
          ["Note sentiment", "−12 to 12", "Recent note sentiment, weighted toward the newest, plus a trend adjustment"],
          ["Engagement", "0 to 5", "Human touches in the last 30 days"],
        ],
      ),
      p("Won is always 100 and Lost always 0. The score recalculates whenever the deal or its notes change, and a nightly pass refreshes recency so untouched deals cool off on their own."),
      note("Why the model is arithmetic, not a prediction", "The formula is deterministic so it can be tested, costs nothing to re-run, and can always be explained to whoever disagrees with it. The AI's contribution is the sentiment of each note, which feeds one component."),
    ],
  },
  {
    id: "drafting",
    title: "Draft follow-up",
    body: [
      p("On any deal or contact, <b>Draft follow-up</b> writes the next email for you."),
      fig("20-draft-dialog-empty", "The drafting dialog before generating."),
      ol([
        "Optionally say what the email should do, for example \"nudge on the revised pricing\".",
        "Pick a tone: professional, friendly or concise.",
        "<b>Generate</b>. The model reads the contact, the deal and its stage, the last eight timeline entries, open tasks and the most recent meeting summary.",
        "Edit the subject and body freely. They are ordinary text boxes.",
        "<b>Send &amp; log to timeline</b>, or copy it, or open it in your mail client.",
      ]),
      fig("21-draft-generated", "A generated draft. The badge says whether Claude wrote it or the template did."),
      note("Nothing is ever sent automatically", "The AI only ever fills the box. Sending is always a click you make, and the sent email is written to the timeline so the history stays complete."),
      controls([
        ["Purpose field", "Top of the dialog", "Optional steer for what the email should achieve."],
        ["Tone dropdown", "Top of the dialog", "Professional, friendly or concise."],
        ["Generate / Regenerate", "Top of the dialog", "Writes a draft. Becomes Regenerate once one exists."],
        ["Source badge", "Above the draft", "Generated by Claude, or Template when AI is offline."],
        ["To / Subject / Body", "The draft", "All editable before sending."],
        ["Copy", "Footer", "Copies subject and body to the clipboard."],
        ["Open in mail client", "Footer", "Hands the draft to your email program."],
        ["Send & log to timeline", "Footer", "Sends if SMTP is configured, and always writes the email to the timeline."],
      ]),
    ],
  },
  {
    id: "meetings",
    title: "Meeting summaries",
    body: [
      p("<b>Summarize meeting</b> on a deal turns a call transcript into a summary, tasks and a sentiment reading."),
      fig("22-meeting-dialog-empty", "The transcript dialog. Paste text or upload a file."),
      table(
        ["Output", "What happens to it"],
        [
          ["Summary", "Written to the deal timeline as a meeting entry"],
          ["Action items", "Created as tasks on the deal, with owner and due date where stated"],
          ["Sentiment", "Feeds the note sentiment component of the lead score"],
          ["Next steps and topics", "Shown on the meeting card for context"],
        ],
      ),
      fig("23-meeting-summary-result", "A processed transcript: summary, action items, next steps and sentiment."),
      p("Processing happens in the background, so a long transcript never blocks the page. The card shows <b>Queued</b>, then <b>Summarising</b>, and fills in when done. Past meetings live on the <b>Meetings</b> tab."),
      fig("19-meeting-card", "The Meetings tab, showing a previously processed call."),
      controls([
        ["Title field", "Dialog", "Optional. Defaults to today's date."],
        ["Upload .txt / .vtt", "Dialog", "Reads a transcript file into the box."],
        ["Transcript box", "Dialog", "Paste the transcript. A character count sits underneath."],
        ["Summarize", "Dialog", "Queues the transcript. Disabled under 20 characters."],
        ["Summarize another", "After processing", "Clears the form for a second transcript."],
        ["Retry", "Meeting card", "Re-runs a meeting that failed or ran while AI was offline."],
      ]),
    ],
  },
  {
    id: "ask",
    title: "Ask your CRM",
    body: [
      p("Type a question about your pipeline and get a filtered table back, not a paragraph."),
      fig("24-ask-empty", "The question screen with its example prompts."),
      p("Every answer shows the query that actually ran as a row of chips, so you can always check the machine understood you."),
      fig("25-ask-result", "A question, the validated query it became, and the resulting table."),
      h3("Questions it answers well"),
      ul([
        "Show me deals over $10k closing this month",
        "Which contacts have not been touched in 30 days?",
        "My at-risk deals, biggest first",
        "Open deals in negotiation with a score above 70",
        "Contacts at Northwind tagged enterprise",
      ]),
      h3("What it refuses"),
      p("Anything that writes, deletes or sends. Anything needing analysis it cannot express as a filter. Anything unrelated to the CRM. It says so plainly rather than guessing."),
      fig("26-ask-refusal", "A refused request. The reason is stated rather than a guess being attempted."),
      note("The model never touches the database", "It proposes a small typed filter. The server checks every field and operator against a fixed allowlist, resolves the dates, rejects anything shaped like an injection, then runs a read-only query with your own access scope applied. A member cannot widen their view by asking nicely."),
      controls([
        ["Question box", "Top", "Your question. Enter or Ask submits."],
        ["Ask", "Top", "Submits. Disabled while empty."],
        ["Example chips", "Under the box", "Fill and run that question immediately."],
        ["Filter chips", "Each answer", "The validated query that actually ran."],
        ["Result rows", "Each answer", "Click through to the deal or contact."],
      ]),
    ],
  },
  {
    id: "search",
    title: "Semantic search",
    body: [
      p("Search notes by meaning rather than keyword. Describe the situation you are trying to find."),
      fig("27-search-empty", "The search screen with example phrasings."),
      p("Searching <b>pricing pushback</b> surfaces \"budget has been cut for this quarter\" and \"the quote is about 30% above their budget line\", neither of which contains a word from the query."),
      fig("28-search-results", "Results for a paraphrase. The badge confirms semantic mode; each hit shows its match strength."),
      table(
        ["Badge", "Means"],
        [
          ["Semantic match", "Real meaning-based search over embeddings"],
          ["Keyword fallback", "The embedding model or vector store was unavailable, so plain text search ran instead. The reason is shown next to the badge."],
        ],
      ),
      controls([
        ["Search box", "Top", "Searches as you type, after a short pause."],
        ["Example chips", "Under the box", "Fill the box with that phrase."],
        ["Match percentage", "Each result", "How close the note is to your query."],
        ["Deal / contact link", "Each result", "Opens the record the note belongs to."],
      ]),
    ],
  },
  {
    id: "duplicates",
    title: "Duplicate detection",
    body: [
      p("<span class=\"admin-only\">Admin only.</span> New and edited contacts are checked automatically, and a full sweep runs nightly. Likely duplicates land in a review queue rather than being merged."),
      fig("34-duplicates", "The review queue. Each pair is shown side by side with the reasons it matched."),
      p("The matcher is built for the ways duplicates actually happen: a typo in an email, a mistyped domain, a nickname, a swapped name order, a reformatted phone, a company written two ways. Two different people at the same company are not duplicates and are not flagged."),
      h3("Reviewing a pair"),
      ul([
        "<b>Keep this one</b> on the record you want to survive. Deals, notes, tasks and meetings move across, empty fields are filled from the other record, tags are combined, and the merge is logged on the timeline.",
        "<b>Not a duplicate</b> dismisses the pair so it stops coming back.",
      ]),
      note("Merging never happens on its own", "The queue is a suggestion. A person always picks the survivor, and the app asks for confirmation first. The retired record is hidden rather than deleted, so older links still resolve."),
      controls([
        ["Scan all contacts", "Top right", "Queues a full sweep instead of waiting for the nightly one."],
        ["Match percentage", "Each pair", "How confident the matcher is."],
        ["Reasons", "Each pair", "The specific signals that matched, such as a mistyped domain."],
        ["Keep this one", "Each record", "Merges the other record into this one, after confirming."],
        ["Not a duplicate", "Each pair", "Dismisses the pair permanently."],
        ["Contact name", "Each record", "Opens that contact in full."],
      ]),
    ],
  },
  {
    id: "risk",
    title: "Risk flagging",
    body: [
      p("Open deals are checked on every change and again by a daily scan. Four signals can fire."),
      table(
        ["Signal", "Fires when"],
        [
          ["Stalled", "The deal has sat in its stage past that stage's threshold, 14 days early on and 21 later"],
          ["Inactive", "Nobody has touched it for longer than the inactivity window, 14 days by default"],
          ["Sentiment negative", "Recent notes are negative, or sentiment has dropped sharply against older notes"],
          ["Closing soon, unready", "The close date is within a week but the deal is still early stage"],
        ],
      ),
      p("Flagged deals collect at the top of the dashboard, each with a plain-English reason and a suggested next step. When AI is on, Claude writes that explanation from the actual notes. When it is off, you get the rule-based version, which is shorter but just as specific."),
      p("A deal drops off the list as soon as the underlying signals clear. Won and Lost deals are never flagged."),
    ],
  },
  {
    group: "Contacts",
    id: "contacts",
    title: "Contacts",
    body: [
      fig("29-contacts-list", "The contacts list. The score column is the contact's strongest open deal."),
      p("Search matches name, email, company and tags at once. Every column header with an arrow sorts."),
      h3("Creating one"),
      fig("30-contact-dialog", "The contact dialog. Only the name is required."),
      p("Saving triggers a background duplicate check against everyone already in the system."),
      fig("31-contact-created", "Confirmation after creating a contact."),
      h3("The detail page"),
      fig("32-contact-detail", "A contact: their deals, timeline, tasks and profile."),
      note("Deleting is a cascade", "Deleting a contact removes their deals, notes, tasks and meetings too. To collapse two records into one without losing anything, use the duplicate queue instead.", "warn"),
      controls([
        ["Search box", "Toolbar", "Matches name, email, company and tags."],
        ["New contact", "Toolbar", "Opens the contact dialog."],
        ["Name / Email / Phone / Company", "Dialog", "Only the name is required."],
        ["Tags", "Dialog", "Comma separated."],
        ["Profile notes", "Dialog", "Free text about the person."],
        ["Owner", "Dialog", "Admins only. Members always own what they create."],
        ["Draft follow-up", "Detail header", "Writes an email to this person."],
        ["New deal", "Detail header", "Creates a deal with this contact pre-selected."],
        ["Edit", "Detail header", "Reopens the dialog."],
        ["Delete icon", "Detail header", "Removes the contact and everything attached, after confirming."],
      ]),
    ],
  },
  {
    group: "Running the system",
    id: "roles",
    title: "Roles and access",
    body: [
      p("Two roles. Scoping is applied in the database query, not in the interface, so it holds on every route including the AI ones."),
      table(
        ["", "Member", "Admin"],
        [
          ["Contacts, deals, notes, tasks", "Own records only", "Everything"],
          ["Ask your CRM, semantic search", "Scoped to own records", "Everything"],
          ["Assign an owner", "No", "Yes"],
          ["Duplicate review and merge", "No", "Yes"],
          ["AI usage and cost", "No", "Yes"],
          ["Create users, run jobs", "No", "Yes"],
        ],
      ),
      fig("37-member-dashboard", "The same dashboard as a member. Smaller pipeline, and the Admin group is gone from the rail."),
    ],
  },
  {
    id: "usage",
    title: "AI usage and cost",
    body: [
      p("<span class=\"admin-only\">Admin only.</span> Every AI call is logged: tokens in and out, cache reads, latency, status and an estimated cost."),
      fig("35-ai-usage", "The usage page. Provider health, spend, and a per-feature breakdown."),
      h3("Statuses"),
      table(
        ["Status", "Means"],
        [
          ["ok", "A real model call, billed"],
          ["cached", "Served from the response cache. No tokens, no cost"],
          ["fallback", "No provider configured, so the built-in path ran"],
          ["error / timeout", "The call failed and the feature degraded"],
        ],
      ),
      fig("35b-ai-usage-full", "The full page including the live feed of recent calls.", { tall: true }),
      p("The provider card shows the circuit breaker. After repeated failures it opens and calls fail fast instead of hanging, then recovers on its own. <b>Reset</b> clears it immediately."),
      controls([
        ["Window dropdown", "Top right", "1, 7, 30 or 90 days."],
        ["Reset", "Provider card", "Closes an open circuit breaker immediately. Only shown when it is not closed."],
        ["risk-scan", "Background jobs", "Re-checks every open deal for risk."],
        ["rescore", "Background jobs", "Refreshes every score."],
        ["dedupe-scan", "Background jobs", "Full duplicate sweep."],
      ]),
      fig("36-job-queued", "A background job queued by hand."),
    ],
  },
  {
    id: "jobs",
    title: "Background jobs",
    body: [
      p("Work that would make you wait happens off the request. Scoring, sentiment, embedding, summarizing, duplicate checks and risk assessment all run as jobs, and rapid edits to one record collapse into a single job."),
      table(
        ["Scheduled job", "Runs", "Does"],
        [
          ["Risk scan", "Daily, 6am", "Re-checks every open deal for risk signals"],
          ["Rescore", "Daily, 5am", "Refreshes scores so untouched deals cool off"],
          ["Duplicate sweep", "Daily, 5.30am", "Full pass over contacts"],
        ],
      ),
    ],
  },
  {
    id: "config",
    title: "Configuration",
    body: [
      p("Copy <code>.env.example</code> to <code>.env</code>. Every setting has a working default; the ones below are worth changing."),
      h3("Turning on Claude"),
      code(`ANTHROPIC_API_KEY=sk-ant-...\nANTHROPIC_MODEL=claude-opus-5`),
      p("Restart, and the header pill turns green."),
      h3("Persistent data and durable jobs"),
      code(`docker compose up -d          # database + redis\nMONGODB_URI=mongodb://localhost:27017/crm\nREDIS_URL=redis://localhost:6379\nnpm run seed -w @loom/api      # add --reset to wipe`),
      h3("Embeddings and vector search"),
      p("By default a small model runs inside the app and needs no key. Set <code>VOYAGE_API_KEY</code> or <code>OPENAI_API_KEY</code> to use a hosted one. For large note volumes, set <code>PINECONE_API_KEY</code> and <code>PINECONE_INDEX</code>."),
      h3("Tuning"),
      table(
        ["Setting", "Default", "Effect"],
        [
          ["RISK_INACTIVITY_DAYS", "14", "Silence before a deal counts as inactive"],
          ["AI_TIMEOUT_MS", "45000", "How long an AI call may take before falling back"],
          ["AI_RATE_LIMIT_PER_MINUTE", "30", "AI requests per user per minute"],
          ["AI_CIRCUIT_FAILURES", "4", "Consecutive failures before the circuit opens"],
          ["SMTP_URL", "unset", "Set to actually deliver email; otherwise drafts are logged only"],
        ],
      ),
    ],
  },
  {
    id: "offline",
    title: "When AI is off",
    body: [
      p("No feature disappears without a provider, and none of them break a screen. Each degrades to something honest and says so in the interface."),
      table(
        ["Feature", "Without a provider"],
        [
          ["Lead scoring", "Sentiment comes from a keyword model. The score formula is unchanged."],
          ["Draft follow-up", "A stage-appropriate template, labelled as one."],
          ["Ask your CRM", "Built-in rules handle the common questions. Anything else says so."],
          ["Meeting summaries", "Extracted summary and commitment-style action items."],
          ["Semantic search", "Keyword search, with the reason shown."],
          ["Duplicates", "Full matching, minus the written verdict."],
          ["Risk flagging", "The same signals with a rule-based explanation."],
        ],
      ),
      p("The same applies when the provider is merely slow or erroring. A timeout falls back rather than hanging the page."),
    ],
  },
  {
    id: "mobile",
    title: "On a phone",
    body: [
      p("The rail collapses into a scrolling row of links across the top, and the dashboard becomes a single column. Tables scroll sideways inside their own container, so the page itself never does."),
      fig("38-mobile-dashboard", "The dashboard on a phone."),
    ],
  },
  {
    id: "trouble",
    title: "Troubleshooting",
    body: [
      h3("Everything logged me out"),
      p("The API restarted while running the in-memory database, so it reseeded with new accounts. Sign back in. Set a database URL to stop this."),
      h3("A score or risk flag looks stale"),
      p("Both update on a background job a moment after the change. <b>Recompute</b> on the deal page forces it. If nothing moves, check the circuit breaker on the AI usage page."),
      h3("Semantic search says keyword fallback"),
      p("Either nothing has been embedded yet, or the embedding model is still loading on first run, or the vector store is unreachable. Hover the status pill to see which."),
      h3("A meeting stayed queued"),
      p("Open it and use <b>Retry</b>. If the provider was down, the retry will pick it up once it recovers."),
      h3("My question was rejected"),
      p("The rejection text says why. Usually the question asked for a write, or for an aggregate the filter language cannot express. Rephrase it as a filter over deals or contacts."),
    ],
  },
];

// ---------- render ----------

let toc = "";
let main = "";
let lastGroup = "";
for (const s of SECTIONS) {
  if (s.group && s.group !== lastGroup) {
    toc += `<p>${s.group}</p>`;
    lastGroup = s.group;
  }
  toc += `<a href="#${s.id}">${s.title}</a>`;
  main += `<section id="${s.id}"><h2>${s.title}</h2>${s.body.join("\n")}</section>`;
}

const html = `<title>LOOM Illustrated Handbook</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{
  --ground:#F4F6F8;--paper:#fff;--sunk:#EDF0F3;--ink:#0E1319;--ink-2:#4E5B67;--ink-3:#7D8B97;
  --line:#DFE4E9;--line-strong:#C6CFD6;--signal:#0B6E8C;--signal-wash:#E4F1F5;
  --good:#17794B;--good-wash:#E3F2E9;--caution:#8A5B10;--caution-wash:#F8EFDF;--bad:#B3372F;
  --lift:0 1px 2px rgba(14,19,25,.05),0 10px 30px -22px rgba(14,19,25,.35);
  --sans:"Instrument Sans",ui-sans-serif,system-ui,"Segoe UI",sans-serif;
  --serif:"Instrument Serif",ui-serif,Georgia,serif;
  --mono:"JetBrains Mono",ui-monospace,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#0B1014;--paper:#151D23;--sunk:#111820;--ink:#E9EFF2;--ink-2:#A6B4BD;--ink-3:#7A8892;
  --line:#253138;--line-strong:#35454E;--signal:#52C2DA;--signal-wash:#122E36;
  --good:#5FCB8C;--good-wash:#12291C;--caution:#E0AC55;--caution-wash:#2A2113;--bad:#E8776C;
  --lift:0 1px 2px rgba(0,0,0,.45),0 10px 30px -22px rgba(0,0,0,.9);
}}
:root[data-theme="dark"]{
  --ground:#0B1014;--paper:#151D23;--sunk:#111820;--ink:#E9EFF2;--ink-2:#A6B4BD;--ink-3:#7A8892;
  --line:#253138;--line-strong:#35454E;--signal:#52C2DA;--signal-wash:#122E36;
  --good:#5FCB8C;--good-wash:#12291C;--caution:#E0AC55;--caution-wash:#2A2113;--bad:#E8776C;
  --lift:0 1px 2px rgba(0,0,0,.45),0 10px 30px -22px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
.shell{max-width:84rem;margin:0 auto;padding:0 1.25rem}
.mast{padding:4rem 0 2.5rem;border-bottom:1px solid var(--line)}
.kicker{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--signal);margin:0 0 1rem}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(2.6rem,6vw,4rem);line-height:1;letter-spacing:-.02em;margin:0 0 1rem;text-wrap:balance}
.standfirst{font-size:1.1rem;color:var(--ink-2);max-width:44rem;margin:0}
.cols{display:grid;grid-template-columns:1fr;gap:2.5rem;padding:2.5rem 0 6rem}
@media(min-width:64rem){.cols{grid-template-columns:15rem minmax(0,1fr);gap:3.5rem}}
nav.toc{align-self:start}
@media(min-width:64rem){nav.toc{position:sticky;top:1.5rem;max-height:calc(100dvh - 3rem);overflow-y:auto;scrollbar-width:thin}}
nav.toc p{font-family:var(--mono);font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:1.5rem 0 .5rem}
nav.toc p:first-child{margin-top:0}
nav.toc a{display:block;padding:.3rem .6rem;margin-left:-.6rem;border-radius:6px;color:var(--ink-2);text-decoration:none;font-size:.89rem;transition:background-color .18s,color .18s}
nav.toc a:hover{background:var(--sunk);color:var(--ink)}
main{min-width:0;display:flex;flex-direction:column;gap:3.5rem}
section{scroll-margin-top:1.5rem;display:flex;flex-direction:column;gap:1.1rem}
h2{font-family:var(--serif);font-weight:400;font-size:2rem;line-height:1.15;letter-spacing:-.012em;margin:0;padding-bottom:.7rem;border-bottom:2px solid var(--line-strong);text-wrap:balance}
h3{font-size:1.05rem;font-weight:600;margin:.8rem 0 0}
p{margin:0;max-width:46rem}
ul,ol{margin:0;padding-left:1.15rem;display:flex;flex-direction:column;gap:.45rem;max-width:46rem}
li::marker{color:var(--ink-3)}
code{font-family:var(--mono);font-size:.85em;background:var(--sunk);padding:.1em .38em;border-radius:4px}
pre{margin:0;background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:1rem 1.15rem;overflow-x:auto;font-family:var(--mono);font-size:.82rem;line-height:1.8}
pre code{background:none;padding:0}
figure{margin:.5rem 0;display:flex;flex-direction:column;gap:.55rem}
figure img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:10px;box-shadow:var(--lift);background:var(--paper)}
figure.tall img{max-height:56rem;object-fit:contain;object-position:top}
figcaption{font-size:.85rem;color:var(--ink-3);max-width:46rem}
.note{border-left:3px solid var(--signal);background:var(--signal-wash);border-radius:0 8px 8px 0;padding:.9rem 1.1rem;display:flex;flex-direction:column;gap:.4rem}
.note.warn{border-left-color:var(--caution);background:var(--caution-wash)}
.note strong{font-size:.82rem}
.note p{font-size:.93rem;color:var(--ink-2)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--paper)}
table{border-collapse:collapse;width:100%;min-width:34rem}
th,td{text-align:left;padding:.68rem .9rem;border-bottom:1px solid var(--line);font-size:.91rem;vertical-align:top}
thead th{font-family:var(--mono);font-size:.63rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);font-weight:600;background:var(--sunk);border-bottom:1px solid var(--line-strong)}
tbody tr:last-child td{border-bottom:none}
td.first{font-weight:500}
.ctl{font-family:var(--mono);font-size:.78rem;background:var(--signal-wash);color:var(--signal);padding:.15rem .42rem;border-radius:5px;white-space:nowrap}
table.controls td:first-child{white-space:nowrap}
ol.steps{list-style:none;padding:0;counter-reset:s;gap:.9rem}
ol.steps>li{counter-increment:s;position:relative;padding-left:2.2rem}
ol.steps>li::before{content:counter(s);position:absolute;left:0;top:.05rem;inline-size:1.5rem;block-size:1.5rem;border-radius:50%;background:var(--signal-wash);color:var(--signal);font-family:var(--mono);font-size:.72rem;font-weight:600;display:grid;place-items:center}
.admin-only{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;background:var(--caution-wash);color:var(--caution);padding:.15rem .45rem;border-radius:5px;margin-right:.4rem}
a{color:var(--signal)}
:focus-visible{outline:2px solid var(--signal);outline-offset:2px;border-radius:4px}
footer{border-top:1px solid var(--line);padding:1.5rem 0 3rem;color:var(--ink-3);font-size:.85rem}
</style>

<div class="shell">
  <header class="mast">
    <p class="kicker">Illustrated handbook</p>
    <h1>LOOM</h1>
    <p class="standfirst">Every screen, every control and every AI feature, with a screenshot of each. Captured from a running instance, so what you see here is what the app actually does.</p>
  </header>
  <div class="cols">
    <nav class="toc">${toc}</nav>
    <main>${main}</main>
  </div>
  <footer>LOOM illustrated handbook · ${Object.keys(SHOTS).length} screenshots captured from a live instance</footer>
</div>`;

fs.writeFileSync(OUT, html, "utf8");
console.log(`Wrote ${OUT}`);
console.log(`Size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Sections: ${SECTIONS.length}, figures: ${(html.match(/<figure/g) || []).length}, control rows: ${(html.match(/<span class="ctl">/g) || []).length}`);
