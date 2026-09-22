const mongoose = require("mongoose");

// Cached connection promise so serverless/cold-start environments (Render,
// Railway) don't open a new pool on every invocation.
let connectionPromise = null;

function connectToDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn(
      "[db] MONGODB_URI is not set — analytics endpoints will fail until it is configured."
    );
    return Promise.resolve(null);
  }

  if (!connectionPromise) {
    mongoose.set("strictQuery", true);
    connectionPromise = mongoose
      .connect(uri)
      .then((conn) => {
        console.log("[db] Connected to MongoDB");
        return conn;
      })
      .catch((err) => {
        connectionPromise = null;
        console.error("[db] MongoDB connection error:", err.message);
        throw err;
      });
  }

  return connectionPromise;
}

module.exports = { connectToDatabase };
