const express = require("express");
const { fetchTweetData, TweetFetchError } = require("../utils/fetchTweetData");

const router = express.Router();

// POST /api/fetch-tweet  { url: string } -> TweetData JSON
router.post("/fetch-tweet", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "A tweet URL is required." });
  }

  try {
    const tweet = await fetchTweetData(url.trim());
    return res.json(tweet);
  } catch (err) {
    if (err instanceof TweetFetchError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("[fetch-tweet] unexpected error:", err);
    return res
      .status(500)
      .json({ message: "Something went wrong fetching that tweet." });
  }
});

module.exports = router;
