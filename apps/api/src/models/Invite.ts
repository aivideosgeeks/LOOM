import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { ROLES } from "@loom/shared";

/**
 * A pending invitation to join.
 *
 * The raw token is never stored. It is generated once, put in the link, and only its
 * SHA-256 hash is kept, so a leaked database dump cannot be used to accept invitations.
 * Accepting sets `acceptedAt`, which makes the token single-use.
 */
const inviteSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, enum: ROLES, default: "member", required: true },
    name: { type: String, trim: true, default: null },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedUser: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

// One live invitation per address; accepted ones keep their row for the audit trail.
inviteSchema.index({ email: 1, acceptedAt: 1 });

export type InviteAttrs = InferSchemaType<typeof inviteSchema>;
export type InviteDoc = HydratedDocument<InviteAttrs>;
export const Invite = model("Invite", inviteSchema);
