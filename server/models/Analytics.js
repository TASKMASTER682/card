const mongoose = require("mongoose");

// One document per generation/download event. Kept intentionally lean —
// this powers simple usage counts and "most used theme" reporting, not a
// full event pipeline.
const CardAnalyticsSchema = new mongoose.Schema(
  {
    tweetUrl: {
      type: String,
      required: false,
      trim: true,
      maxlength: 2048,
    },
    cardType: {
      type: String,
      enum: ["url", "custom_text"],
      required: true,
    },
    themeUsed: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    downloadsCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

CardAnalyticsSchema.index({ createdAt: -1 });
CardAnalyticsSchema.index({ themeUsed: 1 });

module.exports = mongoose.model("CardAnalytics", CardAnalyticsSchema);
