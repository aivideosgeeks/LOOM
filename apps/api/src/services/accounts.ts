import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Role } from "@loom/shared";
import { env } from "../config/env";
import { sha256 } from "../lib/hash";
import { badRequest, HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { Contact, Deal, Invite, Meeting, Note, Task, User, type InviteDoc, type UserDoc } from "../models";
import { sendEmail } from "./email";

const INVITE_TTL_DAYS = 7;
const BCRYPT_ROUNDS = 10;

export const isExpired = (invite: { expiresAt: Date | null | undefined }) =>
  !invite.expiresAt || invite.expiresAt.getTime() < Date.now();

/** True while the instance has no accounts, which is the only time setup is allowed. */
export async function needsSetup(): Promise<boolean> {
  return (await User.countDocuments()) === 0;
}

/**
 * Creates the very first administrator. Guarded on the user count so it can only ever
 * run once; a second caller loses the race and is refused.
 */
export async function createFirstAdmin(input: { name: string; email: string; password: string }): Promise<UserDoc> {
  if (!(await needsSetup())) throw new HttpError(409, "This instance is already set up. Ask an administrator for an invitation.");
  const user = await User.create({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    role: "admin",
  });
  // If two requests raced, keep the earliest and undo this one.
  const admins = await User.countDocuments();
  if (admins > 1) {
    const earliest = await User.findOne().sort({ createdAt: 1 }).lean();
    if (earliest && String(earliest._id) !== String(user._id)) {
      await user.deleteOne();
      throw new HttpError(409, "This instance is already set up. Ask an administrator for an invitation.");
    }
  }
  logger.info({ email: user.email }, "First administrator created");
  return user;
}

function inviteLink(token: string): string {
  return `${env.WEB_ORIGIN.replace(/\/$/, "")}/invite/${token}`;
}

function inviteBody(link: string, invitedByName: string | null, role: Role): string {
  const who = invitedByName ? `${invitedByName} has invited you` : "You have been invited";
  return [
    `${who} to join LOOM as ${role === "admin" ? "an administrator" : "a member"}.`,
    "",
    "Set your password and get started here:",
    link,
    "",
    `The link works once and expires in ${INVITE_TTL_DAYS} days.`,
    "If you were not expecting this, you can ignore this message.",
  ].join("\n");
}

/**
 * Issues an invitation. Any earlier unaccepted invitation for the same address is
 * replaced, so a resend always invalidates the previous link.
 */
export async function createInvite(input: { email: string; role: Role; name?: string }, invitedBy: { id: string; name: string }) {
  const email = input.email.toLowerCase().trim();
  if (await User.findOne({ email })) throw new HttpError(409, "Someone with that email address already has an account.");

  await Invite.deleteMany({ email, acceptedAt: null });

  const token = randomBytes(32).toString("base64url");
  const invite = await Invite.create({
    email,
    role: input.role,
    name: input.name?.trim() || null,
    tokenHash: sha256(token),
    invitedBy: invitedBy.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  });

  const link = inviteLink(token);
  const delivery = await sendEmail({
    to: email,
    subject: "Your invitation to LOOM",
    body: inviteBody(link, invitedBy.name, input.role),
  });

  logger.info({ email, role: input.role, emailed: delivery.sent }, "Invitation issued");
  return { invite, link, delivery };
}

export async function resendInvite(inviteId: string, invitedBy: { id: string; name: string }) {
  const existing = await Invite.findById(inviteId);
  if (!existing) throw new HttpError(404, "Invitation not found");
  if (existing.acceptedAt) throw badRequest("That invitation has already been accepted.");
  return createInvite({ email: existing.email, role: existing.role as Role, name: existing.name ?? undefined }, invitedBy);
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const invite = await Invite.findById(inviteId);
  if (!invite) throw new HttpError(404, "Invitation not found");
  if (invite.acceptedAt) throw badRequest("That invitation has already been accepted.");
  await invite.deleteOne();
}

/** Looks up a live invitation by its raw token. Returns null for unknown, used or expired tokens. */
export async function findLiveInvite(token: string): Promise<InviteDoc | null> {
  if (!token || token.length < 20) return null;
  const invite = await Invite.findOne({ tokenHash: sha256(token), acceptedAt: null });
  if (!invite || isExpired(invite)) return null;
  return invite;
}

export async function acceptInvite(token: string, input: { name: string; password: string }): Promise<UserDoc> {
  const invite = await findLiveInvite(token);
  if (!invite) throw badRequest("That invitation link is invalid, already used, or expired. Ask for a new one.");
  if (await User.findOne({ email: invite.email })) {
    await invite.deleteOne();
    throw new HttpError(409, "An account with that email address already exists. Try signing in instead.");
  }

  const user = await User.create({
    name: input.name,
    email: invite.email,
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    role: invite.role,
  });

  invite.acceptedAt = new Date();
  invite.acceptedUser = user._id;
  await invite.save();

  logger.info({ email: user.email, role: user.role }, "Invitation accepted");
  return user;
}

/** Records owned by a user, used to block a removal that would orphan data. */
export async function ownedCounts(userId: string) {
  const [contacts, deals, notes, tasks, meetings] = await Promise.all([
    Contact.countDocuments({ owner: userId }),
    Deal.countDocuments({ owner: userId }),
    Note.countDocuments({ owner: userId }),
    Task.countDocuments({ owner: userId }),
    Meeting.countDocuments({ owner: userId }),
  ]);
  return { contacts, deals, notes, tasks, meetings, total: contacts + deals + notes + tasks + meetings };
}

async function assertNotLastAdmin(userId: string, action: string) {
  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, "User not found");
  if (user.role !== "admin") return;
  const admins = await User.countDocuments({ role: "admin" });
  if (admins <= 1) throw badRequest(`This is the only administrator, so you cannot ${action}. Promote someone else first.`);
}

export async function changeRole(userId: string, role: Role, actingUserId: string): Promise<UserDoc> {
  if (userId === actingUserId && role !== "admin") throw badRequest("You cannot remove your own administrator access.");
  if (role !== "admin") await assertNotLastAdmin(userId, "change their role");
  const user = await User.findByIdAndUpdate(userId, { $set: { role } }, { new: true });
  if (!user) throw new HttpError(404, "User not found");
  return user;
}

/**
 * Removes an account. Refused while the user still owns records, so nothing is
 * silently orphaned: reassign their work first.
 */
export async function removeUser(userId: string, actingUserId: string): Promise<void> {
  if (userId === actingUserId) throw badRequest("You cannot remove your own account.");
  await assertNotLastAdmin(userId, "remove them");
  const owned = await ownedCounts(userId);
  if (owned.total > 0) {
    const parts = Object.entries(owned)
      .filter(([k, v]) => k !== "total" && v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    throw badRequest(`That person still owns ${parts}. Reassign their records to someone else before removing the account.`);
  }
  const user = await User.findByIdAndDelete(userId);
  if (!user) throw new HttpError(404, "User not found");
  logger.info({ userId }, "Account removed");
}
