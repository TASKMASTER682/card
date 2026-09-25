const express = require("express");
const { fetchLinkedInData, LinkedInFetchError } = require("../utils/fetchLinkedInData");

const router = express.Router();

// POST /api/fetch-linkedin-post  { url: string } -> LinkedIn post JSON
router.post("/fetch-linkedin-post", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "A LinkedIn post URL is required." });
  }

  try {
    const post = await fetchLinkedInData(url.trim());
    return res.json(post);
  } catch (err) {
    if (err instanceof LinkedInFetchError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("[fetch-linkedin-post] unexpected error:", err);
    return res
      .status(500)
      .json({ message: "Something went wrong fetching that LinkedIn post." });
  }
});

module.exports = router;