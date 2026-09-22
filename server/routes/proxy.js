const express = require("express");
const fetch = require("node-fetch");

const router = express.Router();

// GET /api/proxy-image?url=<encoded-url>
// Proxies an image to bypass CORS restrictions for html-to-image capture.
router.get("/proxy-image", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "A url query parameter is required." });
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ message: "Only http/https URLs are allowed." });
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "Cardly/1.0" },
      redirect: "follow",
      timeout: 10000,
    });

    if (!response.ok) {
      return res.status(response.status).json({ message: `Upstream returned ${response.status}` });
    }

    const contentType = response.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    response.body.pipe(res);
  } catch (err) {
    console.error("[proxy-image] error:", err.message);
    return res.status(502).json({ message: "Failed to fetch image." });
  }
});

module.exports = router;
