import { z } from "zod";
import { EMAIL_TONES, NOTE_KINDS, PIPELINE_STAGES, ROLES } from "./constants";

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const dateInput = z
  .string()
  .trim()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

export const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(6).max(200),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES).default("member"),
});

// ---- Accounts: first-run setup and invitations ----

const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Include at least one letter and one number');

/** Only accepted while the database has no users at all. */
export const setupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  password: passwordSchema,
});

export const inviteCreateSchema = z.object({
  email: z.email().max(200),
  role: z.enum(ROLES).default('member'),
  name: z.string().trim().max(120).optional(),
});

export const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
});

export const updateUserRoleSchema = z.object({
  role: z.enum(ROLES),
});

export const contactCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.union([z.email().max(200), z.literal("")]).optional(),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  notes: z.string().max(5000).optional(),
  owner: objectIdSchema.optional(),
});
export const contactUpdateSchema = contactCreateSchema.partial();

export const dealCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  contact: objectIdSchema,
  value: z.coerce.number().min(0).max(1e12),
  stage: z.enum(PIPELINE_STAGES).default("Lead"),
  owner: objectIdSchema.optional(),
  expectedCloseDate: z.union([dateInput, z.literal(""), z.null()]).optional(),
});
export const dealUpdateSchema = dealCreateSchema.partial();

const USER_NOTE_KINDS = NOTE_KINDS.filter((k) => k !== "system") as [string, ...string[]];

export const noteCreateSchema = z.object({
  content: z.string().trim().min(1).max(20000),
  kind: z.enum(USER_NOTE_KINDS).default("note"),
  deal: objectIdSchema.optional(),
  contact: objectIdSchema.optional(),
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  deal: objectIdSchema.optional(),
  contact: objectIdSchema.optional(),
  dueDate: z.union([dateInput, z.literal(""), z.null()]).optional(),
});
export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  done: z.boolean().optional(),
  dueDate: z.union([dateInput, z.literal(""), z.null()]).optional(),
});

export const draftEmailRequestSchema = z.object({
  intent: z.string().trim().max(500).optional(),
  tone: z.enum(EMAIL_TONES).default("professional"),
});

export const sendEmailSchema = z.object({
  to: z.email().max(200),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
});

export const meetingCreateSchema = z.object({
  title: z.string().trim().max(200).optional(),
  transcript: z.string().trim().min(20).max(300000),
});

export const askSchema = z.object({
  question: z.string().trim().min(2).max(500),
});

export const semanticSearchSchema = z.object({
  q: z.string().trim().min(1).max(300),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  stage: z.enum(PIPELINE_STAGES).optional(),
  sort: z.string().max(50).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  atRisk: z.enum(["true", "false"]).optional(),
  owner: objectIdSchema.optional(),
});

export const mergeContactsSchema = z.object({
  survivorId: objectIdSchema,
});
