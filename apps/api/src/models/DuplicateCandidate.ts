import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const duplicateCandidateSchema = new Schema(
  {
    a: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    b: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    /** Sorted "<idA>:<idB>" so each pair exists once. */
    pairKey: { type: String, required: true, unique: true },
    score: { type: Number, required: true, min: 0, max: 1 },
    reasons: { type: [String], default: [] },
    aiVerdict: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ["pending", "merged", "dismissed"], default: "pending", index: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

export type DuplicateCandidateAttrs = InferSchemaType<typeof duplicateCandidateSchema>;
export type DuplicateCandidateDoc = HydratedDocument<DuplicateCandidateAttrs>;
export const DuplicateCandidate = model("DuplicateCandidate", duplicateCandidateSchema);
