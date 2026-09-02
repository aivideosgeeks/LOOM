import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const meetingSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    deal: { type: Schema.Types.ObjectId, ref: "Deal", default: null, index: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    transcript: { type: String, required: true },
    status: { type: String, enum: ["pending", "processing", "done", "failed"], default: "pending", index: true },
    result: { type: Schema.Types.Mixed, default: null },
    source: { type: String, enum: ["ai", "fallback"], default: null },
    error: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

export type MeetingAttrs = InferSchemaType<typeof meetingSchema>;
export type MeetingDoc = HydratedDocument<MeetingAttrs>;
export const Meeting = model("Meeting", meetingSchema);
