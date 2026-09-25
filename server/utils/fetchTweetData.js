const fetch = require("node-fetch");

const TWEET_URL_PATTERN =
  /(?:twitter|x)\.com\/([A-Za-z0-9_]+)\/status(?:es)?\/(\d+)/i;

class TweetFetchError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

/**
 * Strips the oEmbed response's HTML wrapper down to plain tweet text,
 * decoding the handful of entities Twitter's embed HTML actually uses.
 */
function extractPlainText(html) {
  const withoutScript = html.replace(/<script[\s\S]*?<\/script>/gi, "");

  // Twitter's embed ends with an attribution footer:
  // "&mdash; Name (@handle) <a ...>date</a>". Cut everything from the
  // LAST em-dash (the tweet body may legitimately contain earlier ones).
  const footerStart = Math.max(
    withoutScript.lastIndexOf("&mdash;"),
    withoutScript.lastIndexOf("—")
  );
  const withoutFooter =
    footerStart === -1
      ? withoutScript
      : withoutScript.slice(0, footerStart).trim();

  const withoutTags = withoutFooter
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return withoutTags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .trim();
}

/**
 * Fetches real engagement stats (likes / retweets / replies), the true post
 * date, display name and profile picture from the free key-less vxtwitter
 * public API. Returns null on any failure so the caller can keep its
 * existing fallbacks (zero metrics, unavatar, now date).
 */
async function fetchMetricsFromVxTwitter(handle, tweetId) {
  const endpoint = `https://api.vxtwitter.com/${handle}/status/${tweetId}`;
  const res = await fetch(endpoint, {
    headers: { "User-Agent": "social-card-generator/1.0 (node-fetch)" },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") return null;

  // vxtwitter returns the tweet payload at the top level; fxtwitter-style
  // responses nest it under `tweet`. Support both these days of mirrors.
  const tweet = data.tweet || data;

  const rawDate =
    typeof tweet.date_epoch === "number"
      ? new Date(tweet.date_epoch * 1000)
      : tweet.date
        ? new Date(tweet.date)
        : null;
  const createdAt =
    rawDate && !Number.isNaN(rawDate.getTime())
      ? rawDate.toISOString()
      : null;

  return {
    authorName:
      tweet.user_name ||
      tweet.author_name ||
      tweet.author?.name ||
      null,
    avatarUrl:
      tweet.user_profile_image_url ||
      tweet.author_avatar ||
      tweet.author?.avatar_url ||
      null,
    createdAt,
    metrics: {
      likes: typeof tweet.likes === "number" ? tweet.likes : 0,
      reposts: typeof tweet.retweets === "number" ? tweet.retweets : 0,
      replies: typeof tweet.replies === "number" ? tweet.replies : 0,
    },
  };
}

/**
 * Resolves a public tweet URL into card-ready data using free, key-less
 * public endpoints:
 *  - publish.twitter.com/oembed for author name + tweet HTML (official,
 *    no auth required)
 *  - api.vxtwitter.com for real likes/reposts/replies, the real timestamp
 *    and the actual profile picture (merely enriches; never fatal)
 *  - unavatar.io as a last-resort avatar fallback by handle
 */
async function fetchTweetData(tweetUrl) {
  const match = tweetUrl.match(TWEET_URL_PATTERN);
  if (!match) {
    throw new TweetFetchError(
      "That doesn't look like a valid twitter.com or x.com post URL."
    );
  }
  const [, handleFromUrl, tweetId] = match;

  const oembedEndpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(
    tweetUrl
  )}&omit_script=true&dnt=true`;

  const res = await fetch(oembedEndpoint);
  if (!res.ok) {
    throw new TweetFetchError(
      "Couldn't reach that tweet. It may be deleted, private, or protected.",
      404
    );
  }

  const data = await res.json();
  const authorName = data.author_name || handleFromUrl;
  const authorHandle = `@${handleFromUrl}`;
  const body = extractPlainText(data.html || "");

  const vx = await fetchMetricsFromVxTwitter(handleFromUrl, tweetId).catch(
    () => null
  );

  return {
    authorName: vx?.authorName || authorName,
    authorHandle,
    avatarUrl: vx?.avatarUrl || `https://unavatar.io/twitter/${handleFromUrl}`,
    body: body || "This post has no readable text.",
    createdAt: vx?.createdAt || new Date().toISOString(),
    metrics:
      vx?.metrics || { likes: 0, reposts: 0, replies: 0 },
    sourceUrl: tweetUrl,
  };
}

module.exports = { fetchTweetData, TweetFetchError };
