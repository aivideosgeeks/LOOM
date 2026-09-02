import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { NOTE_KINDS } from "@loom/shared";

const sentimentSchema = new Schema(
  {
    score: { type: Number, required: true, min: -1, max: 1 },
    label: { type: String, enum: ["positive", "neutral", "negative"], required: true },
    source: { type: String, enum: ["ai", "lexicon", "manual"], required: true },
    rationale: { type: String, default: null },
  },
  { _id: false },
);

const noteSchema = new Schema(
  {
    kind: { type: String, enum: NOTE_KINDS, default: "note", required: true },
    content: { type: String, required: true },
    contentHash: { type: String, default: null },
    deal: { type: Schema.Types.ObjectId, ref: "Deal", default: null, index: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    author: { type: Schema.Types.ObjectId, ref: "User", default: null },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sentiment: { type: sentimentSchema, default: null },
    meeting: { type: Schema.Types.ObjectId, ref: "Meeting", default: null },
    /** True when the content contained prompt-injection-like instructions. Never blocks, only flags. */
    suspicious: { type: Boolean, default: false },
    embeddingStatus: { type: String, enum: ["pending", "done", "failed", "skipped"], default: "pending" },
  },
  { timestamps: true },
);

noteSchema.index({ content: "text" });
noteSchema.index({ deal: 1, createdAt: -1 });
noteSchema.index({ contact: 1, createdAt: -1 });

export type NoteAttrs = InferSchemaType<typeof noteSchema>;
export type NoteDoc = HydratedDocument<NoteAttrs>;
export const Note = model("Note", noteSchema);
