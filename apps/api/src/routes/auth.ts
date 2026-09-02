import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  acceptInviteSchema,
  createUserSchema,
  inviteCreateSchema,
  loginSchema,
  setupSchema,
  updateUserRoleSchema,
  type InviteDTO,
  type InvitePreview,
  type Role,
} from "@loom/shared";
import { HttpError } from "../lib/errors";
import { toIso } from "../lib/dates";
import { clearAuthCookie, requireAuth, requireRole, setAuthCookie, signToken, type AuthUser } from "../middleware/auth";
import { loginLimiter, setupLimiter } from "../middleware/rateLimit";
import { idParam, validateBody } from "../middleware/validate";
import { Invite, User } from "../models";
import { toUserDTO } from "../services/serializers";
import {
  acceptInvite,
  changeRole,
  createFirstAdmin,
  createInvite,
  findLiveInvite,
  isExpired,
  needsSetup,
  ownedCounts,
  removeUser,
  resendInvite,
  revokeInvite,
} from "../services/accounts";

export const authRouter = Router();

const signIn = (res: Parameters<typeof setAuthCookie>[0], user: { _id: unknown; name: string; email: string; role: string }) => {
  const authUser: AuthUser = { id: String(user._id), name: user.name, email: user.email, role: user.role as Role };
  setAuthCookie(res, signToken(authUser));
};

function toInviteDTO(doc: any, extra: Partial<InviteDTO> = {}): InviteDTO {
  const i = typeof doc?.toObject === "function" ? doc.toObject() : doc;
  const invitedBy = i.invitedBy && typeof i.invitedBy === "object" && "name" in i.invitedBy ? toUserDTO(i.invitedBy) : null;
  return {
    id: String(i._id),
    email: i.email,
    role: i.role,
    name: i.name ?? null,
    invitedBy,
    expiresAt: toIso(i.expiresAt) ?? "",
    expired: isExpired(i),
    createdAt: toIso(i.createdAt) ?? "",
    ...extra,
  };
}

// ---------------------------------------------------------------- first-run setup

/** Public. Tells the sign-in screen whether this instance still needs its first account. */
authRouter.get("/setup-state", async (_req, res) => {
  res.json({ needsSetup: await needsSetup() });
});

/** Public, but only answers while there are no accounts at all. */
authRouter.post("/setup", setupLimiter, validateBody(setupSchema), async (req, res) => {
  const user = await createFirstAdmin(req.body);
  signIn(res, user);
  res.status(201).json({ user: toUserDTO(user) });
});

// ---------------------------------------------------------------- session

authRouter.post("/login", loginLimiter, validateBody(loginSchema), async (req, res) => {
  const user = await User.findOne({ email: req.body.email.toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  signIn(res, user);
  res.json({ user: toUserDTO(user) });
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) {
    clearAuthCookie(res);
    throw new HttpError(401, "Session no longer valid");
  }
  res.json({ user: toUserDTO(user) });
});

// ---------------------------------------------------------------- invitations

/** Public. Shows the invitee who invited them and as what, before they choose a password. */
authRouter.get("/invites/:token", setupLimiter, async (req, res) => {
  const invite = await findLiveInvite(idParam(req, "token"));
  if (!invite) throw new HttpError(404, "That invitation link is invalid, already used, or expired.");
  await invite.populate("invitedBy", "name");
  const invitedBy = invite.invitedBy as unknown as { name?: string } | null;
  const preview: InvitePreview = {
    email: invite.email,
    role: invite.role as Role,
    name: invite.name ?? null,
    invitedByName: invitedBy?.name ?? null,
  };
  res.json({ invite: preview });
});

/** Public. Consumes the invitation, creates the account and signs the new member in. */
authRouter.post("/invites/:token/accept", setupLimiter, validateBody(acceptInviteSchema), async (req, res) => {
  const user = await acceptInvite(idParam(req, "token"), req.body);
  signIn(res, user);
  res.status(201).json({ user: toUserDTO(user) });
});

authRouter.get("/invites", requireRole("admin"), async (_req, res) => {
  const invites = await Invite.find({ acceptedAt: null }).sort({ createdAt: -1 }).populate("invitedBy", "name email role").lean();
  res.json({ invites: invites.map((i) => toInviteDTO(i)) });
});

authRouter.post("/invites", requireRole("admin"), validateBody(inviteCreateSchema), async (req, res) => {
  const { invite, link, delivery } = await createInvite(req.body, { id: req.user!.id, name: req.user!.name });
  await invite.populate("invitedBy", "name email role");
  res.status(201).json({ invite: toInviteDTO(invite, { link, emailed: delivery.sent, emailDetail: delivery.detail }) });
});

authRouter.post("/invites/:id/resend", requireRole("admin"), async (req, res) => {
  const { invite, link, delivery } = await resendInvite(idParam(req), { id: req.user!.id, name: req.user!.name });
  await invite.populate("invitedBy", "name email role");
  res.json({ invite: toInviteDTO(invite, { link, emailed: delivery.sent, emailDetail: delivery.detail }) });
});

authRouter.delete("/invites/:id", requireRole("admin"), async (req, res) => {
  await revokeInvite(idParam(req));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- people

/**
 * The team roster. Administrators only: the only consumer is the owner picker, which is
 * itself admin-only, and a member has no reason to enumerate everyone's name and address.
 */
authRouter.get("/users", requireRole("admin"), async (_req, res) => {
  const users = await User.find().sort({ name: 1 }).lean();
  res.json({ users: users.map(toUserDTO) });
});

/** Kept for scripted setup. Inviting is the route the interface uses. */
authRouter.post("/users", requireRole("admin"), validateBody(createUserSchema), async (req, res) => {
  const exists = await User.findOne({ email: req.body.email.toLowerCase() });
  if (exists) throw new HttpError(409, "A user with that email already exists");
  const user = await User.create({
    name: req.body.name,
    email: req.body.email,
    passwordHash: await bcrypt.hash(req.body.password, 10),
    role: req.body.role,
  });
  res.status(201).json({ user: toUserDTO(user) });
});

authRouter.get("/users/:id/owned", requireRole("admin"), async (req, res) => {
  res.json({ owned: await ownedCounts(idParam(req)) });
});

authRouter.patch("/users/:id/role", requireRole("admin"), validateBody(updateUserRoleSchema), async (req, res) => {
  const user = await changeRole(idParam(req), req.body.role, req.user!.id);
  res.json({ user: toUserDTO(user) });
});

authRouter.delete("/users/:id", requireRole("admin"), async (req, res) => {
  await removeUser(idParam(req), req.user!.id);
  res.json({ ok: true });
});
