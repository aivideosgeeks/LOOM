# LOOM API, packaged for Hugging Face Spaces.
#
# The API runs as one long-lived process, which is the whole reason it lives here
# rather than on Vercel. That process owns three things a serverless function
# cannot keep: the background queue that scores deals and summarises meetings off
# the request path, the cron-driven nightly risk and duplicate scans, and a small
# embedding model held in memory for semantic search.
#
# Records live in MongoDB Atlas, so nothing here is stateful except the model
# cache, which is rebuilt on first request after a cold start.

FROM node:22-slim

# mongodb-memory-server is only reached when MONGODB_URI is unset, but its
# postinstall downloads a full MongoDB server binary regardless. This image talks
# to Atlas, so the download is pure cost.
ENV MONGOMS_DISABLE_POSTINSTALL=1

# Spaces route traffic to 7860. The rest are safe production defaults that a
# Space secret can still override.
ENV NODE_ENV=production \
    PORT=7860 \
    COOKIE_SECURE=true \
    SEED_ON_START=false

# Spaces run containers as uid 1000, which the node image already provides. This
# matters beyond permissions on the source: the embedding cache path resolves
# against the working directory, so the tree has to belong to that user or the
# first semantic search fails on an unwritable cache.
#
# The directory is created explicitly rather than left to WORKDIR, which creates
# missing parents as root even when a USER is already set.
RUN mkdir -p /home/node/app && chown -R node:node /home/node
USER node
WORKDIR /home/node/app

# Every workspace manifest is copied before the sources so the install layer is
# cached and only reruns when a dependency actually changes. npm ci validates the
# lockfile against all workspaces, so the unused manifests must be present even
# though their packages are not installed below.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node e2e/package.json e2e/

# Only the two workspaces the server actually runs. Installing everything would
# pull Next.js and a browser driver that this image never executes.
RUN npm ci --include-workspace-root --workspace @loom/shared --workspace @loom/api

COPY --chown=node:node . .

EXPOSE 7860
CMD ["npm", "run", "start", "-w", "@loom/api"]
