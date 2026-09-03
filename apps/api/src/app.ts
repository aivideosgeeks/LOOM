import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, HttpError } from "./lib/errors";
import { authenticate } from "./middleware/auth";
import { adminRouter } from "./routes/admin";
import { aiRouter } from "./routes/ai";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { cronRouter } from "./routes/cron";
import { dashboardRouter } from "./routes/dashboard";
import { dealsRouter } from "./routes/deals";
import { duplicatesRouter } from "./routes/duplicates";
import { meetingsRouter } from "./routes/meetings";
import { notesRouter } from "./routes/notes";
import { tasksRouter } from "./routes/tasks";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(authenticate);

  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use("/api/auth", authRouter);
  app.use("/api/contacts", contactsRouter);
  app.use("/api/deals", dealsRouter);
  app.use("/api/notes", notesRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/meetings", meetingsRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/duplicates", duplicatesRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/cron", cronRouter);

  app.use((_req, _res, next) => next(new HttpError(404, "Not found")));
  app.use(errorHandler);
  return app;
}
