export const REPO_URL = "https://github.com/thebkht/cliplink";

const REPO_API_URL = "https://api.github.com/repos/thebkht/cliplink";
const STARS_REVALIDATE_SECONDS = 60 * 60;
const STARS_TIMEOUT_MS = 3_000;

/**
 * The repository's star count, or null when GitHub cannot be reached.
 *
 * Cached for an hour so the unauthenticated API's 60-requests-an-hour limit is
 * spent once per hour by the server rather than once per visitor. A failure is
 * never an error: the link still renders, just without the count, and a build
 * with no network still succeeds.
 */
export async function getRepoStars(): Promise<number | null> {
  try {
    const response = await fetch(REPO_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: STARS_REVALIDATE_SECONDS },
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
