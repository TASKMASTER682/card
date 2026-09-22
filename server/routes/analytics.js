const express = require("express");
const CardAnalytics = require("../models/Analytics");

const router = express.Router();

const VALID_CARD_TYPES = new Set(["url", "custom_text"]);

// POST /api/analytics/track  { cardType, themeUsed, tweetUrl? }
// Records one generation/download event. Best-effort: the frontend never
// waits on this or surfaces its errors to the user.
router.post("/analytics/track", async (req, res) => {
  const { cardType, themeUsed, tweetUrl } = req.body || {};

  if (!VALID_CARD_TYPES.has(cardType) || !themeUsed) {
    return res.status(400).json({ message: "Invalid analytics payload." });
  }

  try {
    await CardAnalytics.create({
      cardType,
      themeUsed,
      tweetUrl: cardType === "url" ? tweetUrl : undefined,
    });
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[analytics/track] error:", err.message);
    // Never fail loudly here — analytics should not affect the user's flow.
    return res.status(202).json({ ok: false });
  }
});

// GET /api/analytics/summary — lightweight aggregate for an internal dashboard.
router.get("/analytics/summary", async (_req, res) => {
  try {
    const [totalEvents, byTheme] = await Promise.all([
      CardAnalytics.countDocuments(),
      CardAnalytics.aggregate([
        { $group: { _id: "$themeUsed", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    return res.json({
      totalEvents,
      byTheme: byTheme.map((t) => ({ theme: t._id, count: t.count })),
    });
  } catch (err) {
    console.error("[analytics/summary] error:", err.message);
    return res.status(500).json({ message: "Could not load analytics." });
  }
});

module.exports = router;
