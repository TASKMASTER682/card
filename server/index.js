require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { connectToDatabase } = require("./db");
const { startKeepAlive } = require("./keepalive");
const tweetRoutes = require("./routes/tweet");
const analyticsRoutes = require("./routes/analytics");
const proxyRoutes = require("./routes/proxy");

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  })
);
app.use(express.json({ limit: "100kb" }));

// Basic abuse protection — generous enough for real usage, tight enough to
// stop a script from hammering the tweet-fetch or analytics endpoints.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/api", tweetRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", proxyRoutes);

// Centralized error handler — catches anything a route forgot to try/catch.
app.use((err, _req, res, _next) => {
  console.error("[unhandled]", err);
  res.status(500).json({ message: "Internal server error." });
});

app.use((_req, res) => {
  res.status(404).json({ message: "Not found." });
});

async function start() {
  await connectToDatabase();
  app.listen(PORT, () => {
    console.log(`[server] Cardly API listening on port ${PORT}`);
    startKeepAlive();
  });
}

start();

module.exports = app;
