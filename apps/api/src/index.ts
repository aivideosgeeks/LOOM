import { env } from "./config/env";
import { createApp } from "./app";
import { connectDb } from "./db/connect";
import { startJobs, stopJobs } from "./jobs";
import { logger } from "./lib/logger";
import { getProvider } from "./ai/provider";
import { getEmbeddingProvider } from "./ai/embeddings/provider";
import { User } from "./models";

async function main() {
  const db = await connectDb();

  const userCount = await User.countDocuments();
  if (userCount === 0 && env.SEED_ON_START) {
    const { seedDatabase } = await import("./scripts/seed");
    await seedDatabase();
  }

  getProvider();
  const embeddings = getEmbeddingProvider();
  void embeddings.ready(); // warm the local model in the background

  await startJobs();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close();
    await stopJobs().catch(() => undefined);
    await db.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
