const fetch = require("node-fetch");

// Matches a numeric post id or urn in any public LinkedIn post URL form:
//   /feed/update/urn:li:share:{id}
//   /feed/update/urn:li:activity:{id}
//   /posts/{user}_{slug}-{id}-{suffix}
function extractUrn(url) {
  const urn = url.match(/urn:li:(share|activity):(\d+)/i);
  if (urn) return `urn:li:${urn[1]}:${urn[2]}`;

  const post = url.match(/\/posts\/[^/]*?-(\d{15,})-[A-Za-z0-9]{2,}\/?/);
  if (post) return `urn:li:activity:${post[1]}`;

  return null;
}

function extractOgImage(html) {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .trim();
}

function extractNameFromHtml(html) {
  // Modern LinkedIn SSR embed: the actor name is the link that carries the
  // `feed-actor-name` tracking control, or an aria-label "View profile for X".
  const tracked = html.match(/<a[^>]*data-tracking-control-name=["'][^"']*feed-actor-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (tracked) {
    const name = tracked[1].replace(/<[^>]+>/g, "").trim();
    if (name) return name;
  }
  const aria = html.match(/<a[^>]*aria-label=["']View profile for ([^"']+)["'][^>]*>/i);
  if (aria) return aria[1].trim();

  const patterns = [
    /<a[^>]*class=["'][^"']*actor-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    /<span[^>]*class=["'][^"']*feed-shared-actor__name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<span[^>]*class=["'][^"']*author__name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const name = m[1].replace(/<[^>]+>/g, "").trim();
      if (name) return name;
    }
  }
  return null;
}

// The pretty /posts/{username}_{slug}-{id}-{suffix} and /in/{username} URLs
// carry the author's public handle in the path.
function extractHandle(url) {
  const post = url.match(/linkedin\.com\/posts\/([^_/?#]+)_/i);
  if (post) return post[1];
  const profile = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (profile) return profile[1];
  return "";
}

function extractAvatar(html) {
  const m =
    html.match(/<img[^>]*class=["'][^"']*(?:author__avatar-img|feed-shared-actor__avatar-image)[^"']*["'][^>]*src=["']([^"']+)["']/i) ||
    html.match(/<img[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*(?:author__avatar-img|feed-shared-actor__avatar-image)[^"']*["']/i);
  return m ? m[1] : null;
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBody(html) {
  // The description is the post copy. Try the modern actor markup first,
  // then LinkedIn's older embed markup, then a best-effort generic scan.
  const patterns = [
    /<div[^>]*class=["'][^"']*feed-shared-update-v2__description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<p[^>]*class=["'][^"']*attributed-text-segment-list__content[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    /<div[^>]*class=["'][^"']*update-components-text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const body = stripTags(m[1]);
      if (body) return body;
    }
  }
  return null;
}

function extractTimestamp(html) {
  const m = html.match(/datetime=["']([^"']+)["']/i);
  if (m) {
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const dataTime = html.match(/data-time=["'](\d+)["']/i);
  if (dataTime) {
    const ts = Number(dataTime[1]);
    if (Number.isFinite(ts)) {
      const ms = ts > 1e12 ? ts : ts * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function interactionCount(interactions, typeMatch) {
  if (!Array.isArray(interactions)) return 0;
  const entry = interactions.find((i) => {
    if (!i || !i.interactionType) return false;
    const t =
      typeof i.interactionType === "string"
        ? i.interactionType
        : i.interactionType["@type"] || "";
    return String(t).includes(typeMatch);
  });
  const n = Number(entry?.userInteractionCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The public post page embeds a JSON-LD SocialMediaPosting block that lists
 * like/comment/share counts and the publish timestamp. Parsing it lets us get
 * real engagement numbers without login. Returns null when the page is
 * blocked or the block is missing (never fatal).
 */
async function fetchJsonLd(postUrl) {
  try {
    const res = await fetch(postUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const blocks = html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    if (!blocks) return null;

    for (const block of blocks) {
      const raw = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && item["@type"] === "SocialMediaPosting") {
          const metrics = {
            likes: interactionCount(item.interactionStatistic, "LikeAction"),
            shares: interactionCount(item.interactionStatistic, "ShareAction"),
            replies: interactionCount(item.interactionStatistic, "CommentAction"),
          };
          let createdAt = null;
          if (item.datePublished) {
            const d = new Date(item.datePublished);
            if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
          }
          return { metrics, createdAt };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

class LinkedInFetchError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves a public LinkedIn post URL into card-ready data using free,
 * key-less public endpoints:
 *  - linkedin.com/embed/feed/update/{urn}: full post body, author, thumbnail
 *    (official SSR embed, no auth)
 *  - the post page's JSON-LD: real like/comment/share counts + timestamp
 *    (enrichment; never fatal)
 */
async function fetchLinkedInData(postUrl) {
  const urn = extractUrn(postUrl);
  if (!urn) {
    throw new LinkedInFetchError(
      "That doesn't look like a valid LinkedIn post URL."
    );
  }

  const embedUrl = `https://www.linkedin.com/embed/feed/update/${urn}`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml",
  };

  const res = await fetch(embedUrl, { headers, redirect: "follow" });
  if (!res.ok) {
    throw new LinkedInFetchError(
      "Couldn't reach that LinkedIn post. It may be deleted, private, or protected.",
      res.status >= 500 ? 502 : 404
    );
  }

  const html = await res.text();

  // LinkedIn serves a login wall / error shell for bad URNs — treat a page
  // that carries none of the expected post markup as "not found".
  const hasMarkup =
    /feed-shared-update-v2|attributed-text-segment-list__content|update-components-text|author__avatar|feed-shared-actor__name/i.test(
      html
    );
  if (!hasMarkup) {
    throw new LinkedInFetchError(
      "Couldn't read that LinkedIn post. It may be deleted, private, or protected.",
      404
    );
  }

  const body = extractBody(html);
  const imageUrl = extractOgImage(html);
  const authorName = extractNameFromHtml(html);
  const avatarUrl = extractAvatar(html);
  const authorHandle = extractHandle(postUrl);
  let createdAt = extractTimestamp(html);

  // Real engagement numbers + true publish time from the post page JSON-LD.
  const ld = await fetchJsonLd(postUrl).catch(() => null);
  const metrics = {
    likes: ld?.metrics.likes ?? 0,
    reposts: ld?.metrics.shares ?? 0,
    replies: ld?.metrics.replies ?? 0,
  };
  if (ld?.createdAt) createdAt = ld.createdAt;

  return {
    authorName: authorName || (authorHandle ? `LinkedIn member (${authorHandle})` : "LinkedIn member"),
    authorHandle: authorHandle ? `@${authorHandle}` : "",
    avatarUrl:
      avatarUrl ||
      (authorHandle
        ? `https://unavatar.io/linkedin/${authorHandle}`
        : "https://api.dicebear.com/7.x/notionists/svg?seed=linkedin-post"),
    body: body || "This post has no readable text.",
    createdAt: createdAt || new Date().toISOString(),
    metrics: {
      likes: Number.isInteger(metrics.likes) ? metrics.likes : 0,
      reposts: Number.isInteger(metrics.reposts) ? metrics.reposts : 0,
      replies: Number.isInteger(metrics.replies) ? metrics.replies : 0,
    },
    sourceUrl: postUrl,
    mediaUrl: imageUrl || null,
  };
}

module.exports = { fetchLinkedInData, LinkedInFetchError };