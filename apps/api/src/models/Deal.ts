import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { PIPELINE_STAGES } from "@loom/shared";

const stageHistorySchema = new Schema(
  {
    stage: { type: String, enum: PIPELINE_STAGES, required: true },
    enteredAt: { type: Date, required: true },
  },
  { _id: false },
);

const dealSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    value: { type: Number, required: true, min: 0, default: 0 },
    stage: { type: String, enum: PIPELINE_STAGES, default: "Lead", required: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expectedCloseDate: { type: Date, default: null, index: true },
    stageEnteredAt: { type: Date, default: () => new Date() },
    stageHistory: { type: [stageHistorySchema], default: [] },
    lastActivityAt: { type: Date, default: () => new Date(), index: true },

    // AI lead scoring
    score: { type: Number, default: 0, min: 0, max: 100, index: true },
    scoreBreakdown: { type: Schema.Types.Mixed, default: null },
    scoreInputHash: { type: String, default: null },
    scoredAt: { type: Date, default: null },

    // Risk flagging
    risk: { type: Schema.Types.Mixed, default: null },
    riskHash: { type: String, default: null },
  },
  { timestamps: true, minimize: false },
);

dealSchema.index({ "risk.atRisk": 1 });
dealSchema.index({ title: "text" });

export type DealAttrs = InferSchemaType<typeof dealSchema>;
export type DealDoc = HydratedDocument<DealAttrs>;
export const Deal = model("Deal", dealSchema);
