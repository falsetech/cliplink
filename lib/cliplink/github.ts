export const REPO_URL = "https://github.com/thebkht/cliplink";

const REPO_API_URL = "https://api.github.com/repos/thebkht/cliplink";
const STARS_REFRESH_MS = 60 * 60 * 1000;
/** After a failure, how long before GitHub is asked again. */
const STARS_RETRY_MS = 5 * 60 * 1000;
const STARS_TIMEOUT_MS = 3_000;

type StarsCache = {
  stars: number | null;
  /** When the cached count stops being good enough to serve without asking. */
  staleAt: number;
  refreshing: Promise<number | null> | null;
};

declare global {
  var __cliplinkRepoStars: StarsCache | undefined;
}

/**
 * The repository's star count, or null when GitHub cannot be reached.
 *
 * Held in memory and refreshed at most hourly, so the unauthenticated API's
 * 60-requests-an-hour limit is spent by each server instance once an hour
 * rather than once per visitor. Once there is a count, a stale one is served
 * while the refresh runs behind it, so only an instance's first render waits.
 *
 * Not Next's fetch cache: that refreshes a stale entry in a background fetch
 * this function never sees, and logs that fetch's failure as an error — a
 * GitHub hiccup filled the production logs with `fetch failed`. A failure is
 * never an error: the link still renders, just without the count, and a build
 * with no network still succeeds.
 */
export async function getRepoStars(): Promise<number | null> {
  const cache = (globalThis.__cliplinkRepoStars ??= {
    stars: null,
    staleAt: 0,
    refreshing: null,
  });

  if (Date.now() < cache.staleAt) {
    return cache.stars;
  }

  cache.refreshing ??= fetchStars().then((stars) => {
    cache.refreshing = null;
    // A failure keeps the last count rather than blanking a known one.
    cache.stars = stars ?? cache.stars;
    cache.staleAt = Date.now() + (stars === null ? STARS_RETRY_MS : STARS_REFRESH_MS);
    return cache.stars;
  });

  return cache.stars ?? cache.refreshing;
}

async function fetchStars(): Promise<number | null> {
  try {
    const response = await fetch(REPO_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(STARS_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
}
