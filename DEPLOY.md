# Deploying LOOM

The web app goes to Vercel. The API goes to Render.

**Why they are split.** Vercel runs functions that end when the response is sent. The
API needs a process that outlives the request: it owns the background queue that scores
deals, classifies note sentiment and summarises transcripts, and it holds an embedding
model in memory for semantic search. Putting it on Vercel would mean dropping the queue
and running that work inline, which makes saving a note slow and long transcripts time out.

The browser never talks to Render directly. Next.js rewrites `/api/*` to the API
server-side, so there is one origin, no CORS, and the session cookie stays first-party.

```
Browser ──▶ Vercel (Next.js) ──▶ Render (Express API) ──▶ MongoDB Atlas
             rewrites /api/*        jobs, embeddings
```

---

## 1. Push to GitHub

```bash
git remote add origin https://github.com/aivideosgeeks/LOOM.git
git push -u origin main
```

If the repository does not exist yet, create it first at
[github.com/new](https://github.com/new) as `LOOM`, empty, with no README.

## 2. Create the database

MongoDB Atlas free tier (M0) at [cloud.mongodb.com](https://cloud.mongodb.com).

1. Create a free cluster.
2. **Database Access** → add a user, note the password.
3. **Network Access** → allow `0.0.0.0/0`, since Render's egress IPs are not fixed on the free plan.
4. Copy the connection string. It looks like
   `mongodb+srv://user:pass@cluster.xxxx.mongodb.net/loom?retryWrites=true&w=majority`.
   Keep the `/loom` database name in the path.

## 3. Get a free model key

Either works, and the app runs without one.

| Provider | Where | Notes |
|---|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Free on models ending `:free`. Slower, wide choice. |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Free tier, very fast, rate limited by tokens per minute. |

## 4. Deploy the API to Render

1. [render.com](https://render.com) → **New** → **Blueprint** → pick the LOOM repository.
   It reads `render.yaml` and creates the `loom-api` service.
2. Fill in the variables it asks for:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | The Atlas string from step 2 |
   | `WEB_ORIGIN` | Your Vercel URL, no trailing slash. Leave blank until step 5, then set it. |
   | `OPENROUTER_API_KEY` or `GROQ_API_KEY` | From step 3 |

   `JWT_SECRET` is generated for you. `SEED_ON_START` is already `false`, so you get the
   setup screen rather than the demo team.
3. Wait for the first deploy, then check `https://loom-api-xxxx.onrender.com/api/health`.
   It should return `{"ok":true,...}`.

## 5. Deploy the web app to Vercel

Import the repository, then set:

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Framework | Next.js (detected) |
| `API_URL` | Your Render URL, e.g. `https://loom-api-xxxx.onrender.com` |

Deploy, then go back to Render and set `WEB_ORIGIN` to the Vercel URL. That variable is
what invitation links are built from, so invitations point at the wrong host until it is set.

## 6. Create your account

Open the Vercel URL. Because the database is empty and seeding is off, you get the
one-time setup screen. The account you create is the administrator; everyone else joins
by invitation from **Admin → Team**.

---

## Things to know

**The free Render plan sleeps.** After 15 minutes idle the service spins down, and the
next request takes roughly 50 seconds to wake it. The first page load after a quiet
period will feel broken but is not. The paid plan removes this.

**Memory on the free plan is 512 MB.** The local embedding model fits, but if you see the
service restarting, set `EMBEDDINGS_PROVIDER=none` to fall back to keyword search, or add
a `VOYAGE_API_KEY` and set `EMBEDDINGS_PROVIDER=voyage`.

**Background jobs run in-process by default.** That is fine on a single Render instance.
Jobs are lost if the process restarts mid-flight, and the nightly scans only run while the
service is awake. For durability add an Upstash Redis URL as `REDIS_URL` and the app
switches to a real queue with retries and proper cron.

**Costs.** Everything above has a free tier: Render, MongoDB Atlas M0, OpenRouter and Groq
free models, Upstash, and Vercel Hobby. The only paid path is an Anthropic key, which
buys noticeably better drafts and summaries.
