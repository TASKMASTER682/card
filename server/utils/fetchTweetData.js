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
  const withoutBlockquote = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<a [^>]*>[^<]*<\/a>\s*$/i, ""); // trailing "— Name (@handle) date" link

  const withoutTags = withoutBlockquote
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return withoutTags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Resolves a public tweet URL into card-ready data using free, key-less
 * public endpoints:
 *  - publish.twitter.com/oembed for author name + tweet HTML (official,
 *    no auth required, rate-limited but generous for a small app)
 *  - unavatar.io for a best-effort profile picture by handle
 *
 * NOTE: Twitter/X no longer exposes public like/repost counts without an
 * authenticated v2 API bearer token. If you have one, swap this function
 * to call api.twitter.com/2/tweets and merge real `public_metrics` in.
 * Until then, metrics are returned as zero and are safely toggle-able off
 * in the UI via `showMetrics`.
 */
async function fetchTweetData(tweetUrl) {
  const match = tweetUrl.match(TWEET_URL_PATTERN);
  if (!match) {
    throw new TweetFetchError(
      "That doesn't look like a valid twitter.com or x.com post URL."
    );
  }
  const [, handleFromUrl] = match;

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

  return {
    authorName,
    authorHandle,
    avatarUrl: `https://unavatar.io/twitter/${handleFromUrl}`,
    body: body || "This post has no readable text.",
    createdAt: new Date().toISOString(),
    metrics: { likes: 0, reposts: 0, replies: 0 },
    sourceUrl: tweetUrl,
  };
}

module.exports = { fetchTweetData, TweetFetchError };
