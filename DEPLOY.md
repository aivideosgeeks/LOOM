# Deploying LOOM

The web app goes to Vercel. The API goes to Hugging Face Spaces. Both are free and
neither asks for a card.

**Why they are split.** Vercel runs functions that end when the response is sent. The
API needs a process that outlives the request: it owns the background queue that scores
deals, classifies note sentiment and summarises transcripts, it runs the nightly risk and
duplicate scans, and it holds an embedding model in memory for semantic search. A Space
runs an ordinary container, so all of that keeps working exactly as it does locally.

The browser never talks to the Space directly. Next.js rewrites `/api/*` to the API
server-side, so there is one origin, no CORS, and the session cookie stays first-party.

```
Browser ──▶ Vercel (Next.js) ──▶ HF Space (Express API) ──▶ MongoDB Atlas
             rewrites /api/*      jobs, scans, embeddings
```

---

## 1. Push to GitHub

Already done. The code is at `aivideosgeeks/LOOM` on `main`.

## 2. Create the database

MongoDB Atlas free tier (M0) at [cloud.mongodb.com](https://cloud.mongodb.com).

1. Create a free cluster.
2. **Database Access** → add a user, note the password.
3. **Network Access** → allow `0.0.0.0/0`. Space egress IPs are not fixed.
4. Copy the connection string. It looks like
   `mongodb+srv://user:pass@cluster.xxxx.mongodb.net/loom?retryWrites=true&w=majority`.
   Keep the `/loom` database name in the path, or everything lands in `test`.

## 3. Get a free model key

The app runs without one, in fallback mode. With one, the AI features use a real model.

| Provider | Where | Notes |
|---|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Free on models ending `:free`. Slower, wide choice. |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Free tier, very fast, rate limited by tokens per minute. |

## 4. Deploy the API to a Space

**Create it.** At [huggingface.co/new-space](https://huggingface.co/new-space): name it
`loom-api`, pick **Docker** → **Blank**, hardware **CPU basic (free)**, visibility public.
The Dockerfile and the Space settings in this repo's README front matter do the rest.

**Push the code.** A Space is a git repo, so add it as a second remote. Replace `<user>`
with your Hugging Face username:

```bash
git remote add space https://huggingface.co/spaces/<user>/loom-api
```

```bash
git push space main
```

When asked, the username is your HF username and the password is a **write** access token
from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). Your normal
account password will not work.

**Set the secrets.** In the Space → **Settings** → **Variables and secrets**:

| Name | Kind | Value |
|---|---|---|
| `MONGODB_URI` | Secret | The Atlas string from step 2 |
| `JWT_SECRET` | Secret | Any long random string; `openssl rand -base64 48` |
| `OPENROUTER_API_KEY` or `GROQ_API_KEY` | Secret | From step 3 |
| `WEB_ORIGIN` | Variable | Your Vercel URL, no trailing slash. Set after step 5. |

The image already sets `NODE_ENV`, `PORT`, `COOKIE_SECURE=true` and `SEED_ON_START=false`,
so you get the one-time setup screen rather than the demo team.

**Check it.** When the build finishes, the Space serves at
`https://<user>-loom-api.hf.space`. Open `/api/health` there; it should return
`{"ok":true,...}`.

## 5. Deploy the web app to Vercel

Import the repository at [vercel.com/new](https://vercel.com/new), then set:

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Framework | Next.js (detected) |
| `API_URL` | Your Space URL, e.g. `https://<user>-loom-api.hf.space` |

Leave **Include files outside of the root directory** switched on. It is on by default,
and the build needs it: the web app imports the shared package from `packages/shared`,
which sits outside `apps/web`. `apps/web/vercel.json` installs from the workspace root for
the same reason.

Deploy, then go back to the Space and set `WEB_ORIGIN` to the Vercel URL. Invitation links
are built from that value, so they point at the wrong host until it is set.

## 6. Create your account

Open the Vercel URL. Because the database is empty and seeding is off, you get the one-time
setup screen. The account you create is the administrator; everyone else joins by
invitation from **Admin → Team**.

---

## Things to know

**Free Spaces sleep after 48 hours of inactivity**, not minutes, and wake in a few seconds.
That is considerably kinder than most free tiers. While asleep the nightly scans do not
run; they catch up on the next wake, since scoring is keyed on an input hash and skips
records that have not changed.

**Hardware is 2 vCPU and 16 GB RAM**, which is ample. The embedding model is 23 MB and
loads in well under a second. It downloads on first use after a cold start and is cached
under the working directory.

**Background jobs run in-process.** Fine on a single container. Jobs are lost if it
restarts mid-flight. For durability add an Upstash Redis URL as `REDIS_URL` and the app
switches to BullMQ with retries and real cron.

**The Space is public**, so its URL and source are discoverable. Every API route except
health and the invitation endpoints requires a valid session, so this exposes no data, but
do not treat the URL as a secret.

**Costs.** Everything above is free: Spaces CPU basic, Atlas M0, OpenRouter and Groq free
models, Upstash, Vercel Hobby. The only paid path is an Anthropic key, which buys
noticeably better drafts and summaries.

**Render as an alternative.** [`render.yaml`](render.yaml) still describes the same API as
a Render service, should you ever want it there. Render now requires a card on file before
it will create even a free service, which is why the Space is the default here.
