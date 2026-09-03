# Deploying LOOM

Everything runs on Vercel, as two projects from the same repository. Free, no card.

```
Browser ──▶ loom-web (Next.js)  ──▶ loom-api (Express function) ──▶ MongoDB Atlas
              rewrites /api/*         jobs run on the request path
```

The browser only ever talks to `loom-web`. Next.js rewrites `/api/*` to the API
server-side, so there is one origin, no CORS, and the session cookie stays first-party.
Two projects rather than one because Next.js owns its own `/api` routes, so the Express
app needs its own deployment to keep every route it already has.

---

## 1. Push to GitHub

Already done. The code is at `aivideosgeeks/LOOM` on `main`.

## 2. Create the database

MongoDB Atlas free tier (M0) at [cloud.mongodb.com](https://cloud.mongodb.com). The free
cluster limit is **per project**, so if the Free card is greyed out you already have one:
either reuse it, or make a new project to get another slot.

1. **Database Access** → add a user. Avoid `@ : / ?` in the password or it breaks the URI.
2. **Network Access** → allow `0.0.0.0/0`. Serverless egress IPs are not fixed.
3. **Connect → Drivers** → copy the string, and insert `/loom` before the `?` so the app
   gets its own database instead of writing to `test`:

```
mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/loom?retryWrites=true&w=majority
```

## 3. Get a free model key

Optional. Without one the AI features run in fallback mode, clearly labelled in the UI.

| Provider | Where | Notes |
|---|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Free on models ending `:free` |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Free tier, fast, token-rate limited |

## 4. Deploy the API project

At [vercel.com/new](https://vercel.com/new), import the repository:

| Setting | Value |
|---|---|
| Project name | `loom-api` |
| Root directory | `apps/api` |
| Framework preset | **Other** |

Environment variables:

| Name | Value |
|---|---|
| `MONGODB_URI` | The Atlas string from step 2 |
| `JWT_SECRET` | Any long random string: `openssl rand -base64 48` |
| `COOKIE_SECURE` | `true` |
| `SEED_ON_START` | `false` |
| `CRON_SECRET` | Another random string. Vercel sends it to the cron route as a bearer token; without it the route stays 404. |
| `EMBEDDINGS_PROVIDER` | `none` |
| `OPENROUTER_API_KEY` or `GROQ_API_KEY` | From step 3, optional |
| `WEB_ORIGIN` | The web URL. Set after step 5. |

`QUEUE_PROVIDER` needs no value: it detects the serverless host and switches itself.

Deploy, then check `https://loom-api-xxxx.vercel.app/api/health`. It should return
`{"ok":true,...}`.

## 5. Deploy the web project

Import the **same repository** again:

| Setting | Value |
|---|---|
| Project name | `loom-web` |
| Root directory | `apps/web` |
| Framework | Next.js (detected) |
| `API_URL` | The API URL from step 4, no trailing slash |

Leave **Include files outside of the root directory** on. It is the default, and the build
needs it: the web app imports `packages/shared`, which sits outside `apps/web`.

## 6. Cross-wire and sign in

Set `WEB_ORIGIN` on `loom-api` to the web URL, then redeploy that project. Invitation links
are built from it, so they point at the wrong host until it is set.

Open the web URL. The database is empty and seeding is off, so you get the one-time setup
screen. The account you create is the administrator; everyone else joins by invitation from
**Admin → Team**.

---

## What running serverless changes

The API was written around a process that outlives the request. Vercel freezes it once the
response is sent, so three behaviours differ from local. Nothing is disabled; the app
detects the host and adapts.

**Background work happens inside the request.** Lead scoring, note sentiment, meeting
summarisation and duplicate checks normally run on a worker after responding. Here they run
before responding, so saving a note or a transcript is slower than it is locally. The
guarantees are unchanged: a failing job still cannot fail your request, and a job already
running is not started twice.

**Long transcripts can hit the 60-second function limit.** Summarising a very long meeting
is the one operation likely to reach it. If it does, the summary falls back to extraction
rather than erroring.

**The nightly scans are one daily cron.** Vercel calls `/api/cron/daily`, which runs the
rescore, risk and duplicate passes together. Each is keyed on an input hash and skips
unchanged records, so combining them costs little. Hobby plans allow one run per day.

**Semantic search uses keyword matching** unless you add embeddings. The local model needs
a native runtime too large for a serverless bundle, so `EMBEDDINGS_PROVIDER=none` is the
right setting here. For real semantic search, set `EMBEDDINGS_PROVIDER=voyage` and add a
`VOYAGE_API_KEY`; it is a hosted API, so nothing heavy ships in the bundle.

**To get all of it back**, run the API on any host with a real process. Set `REDIS_URL` for
a durable BullMQ queue and `EMBEDDINGS_PROVIDER=local`, and every behaviour above returns
to the local one. [`Dockerfile`](Dockerfile) and [`render.yaml`](render.yaml) both describe
that deployment; Render needs a card on file, which is why Vercel is the default here.

## Costs

All free: Vercel Hobby, Atlas M0, OpenRouter and Groq free models. The only paid path is an
Anthropic key, which buys noticeably better drafts and summaries.
