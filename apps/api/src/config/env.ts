import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";

// Load .env from the API dir first, then fall back to the repo root.
for (const candidate of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true } as never);
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default("info"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),

  MONGODB_URI: z.string().optional(),
  REDIS_URL: z.string().optional(),
  /**
   * How background work runs. "auto" picks BullMQ when REDIS_URL is set, the
   * inline adapter on a serverless host, and the in-process queue otherwise.
   */
  QUEUE_PROVIDER: z.enum(["auto", "inline", "memory", "bullmq"]).default("auto"),
  /** Shared secret for the scheduled-scan routes. Required to enable them. */
  CRON_SECRET: z.string().optional(),
  SEED_ON_START: bool(true),

  JWT_SECRET: z.string().default("dev-only-change-me-please"),
  JWT_EXPIRES_DAYS: z.coerce.number().default(7),
  COOKIE_SECURE: bool(false),

  AI_PROVIDER: z.enum(["auto", "anthropic", "openrouter", "groq", "custom", "none"]).default("auto"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("deepseek/deepseek-chat-v3.1:free"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  /** For any other OpenAI-compatible gateway (Together, Ollama, OpenAI itself). */
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  AI_TIMEOUT_MS: z.coerce.number().int().default(45_000),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  AI_SERVER_FALLBACKS: bool(true),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(30),
  AI_CIRCUIT_FAILURES: z.coerce.number().int().default(4),
  AI_CIRCUIT_OPEN_MS: z.coerce.number().int().default(60_000),

  EMBEDDINGS_PROVIDER: z.enum(["auto", "local", "voyage", "openai", "none"]).default("auto"),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default("voyage-3.5-lite"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  LOCAL_EMBEDDING_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  TRANSFORMERS_CACHE_DIR: z.string().default(".cache/transformers"),

  PINECONE_API_KEY: z.string().optional(),
  PINECONE_INDEX: z.string().optional(),

  RISK_INACTIVITY_DAYS: z.coerce.number().int().default(14),
  RISK_SCAN_CRON: z.string().default("0 6 * * *"),
  RISK_SCAN_ON_START: bool(true),

  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default("crm@example.com"),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.issues);
  process.exit(1);
}

export const env: Env = parsed.data;
export const isTest = env.NODE_ENV === "test";
export const isProd = env.NODE_ENV === "production";
/**
 * True on hosts that freeze the process once a response is sent, so nothing
 * scheduled for "later" ever runs. Vercel and AWS Lambda both set these.
 */
export const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
