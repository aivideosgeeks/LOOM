import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const contactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: null },
    phone: { type: String, trim: true, default: null },
    company: { type: String, trim: true, default: null },
    tags: { type: [String], default: [] },
    notes: { type: String, default: null },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    score: { type: Number, default: 0, min: 0, max: 100, index: true },
    scoredAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: () => new Date(), index: true },
    /** Set when this contact was merged into another (soft delete). */
    mergedInto: { type: Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
  },
  { timestamps: true },
);

contactSchema.index({ name: "text", email: "text", company: "text" });
contactSchema.index({ email: 1 }, { sparse: true });

export type ContactAttrs = InferSchemaType<typeof contactSchema>;
export type ContactDoc = HydratedDocument<ContactAttrs>;
export const Contact = model("Contact", contactSchema);
