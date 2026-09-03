import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const taskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    deal: { type: Schema.Types.ObjectId, ref: "Deal", default: null, index: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    dueDate: { type: Date, default: null },
    done: { type: Boolean, default: false },
    source: { type: String, enum: ["manual", "meeting", "assistant"], default: "manual" },
    meeting: { type: Schema.Types.ObjectId, ref: "Meeting", default: null },
  },
  { timestamps: true },
);

export type TaskAttrs = InferSchemaType<typeof taskSchema>;
export type TaskDoc = HydratedDocument<TaskAttrs>;
export const Task = model("Task", taskSchema);
