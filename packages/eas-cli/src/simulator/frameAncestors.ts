/**
 * `--frame-ancestor` values: origins of pages that may embed the simulator preview host in a
 * frame. The server applies the same rules; checking here gives a fast, local error.
 */

export const MAX_FRAME_ANCESTORS = 10;

// The shapes serve-sim and expo-device-hub accept: a host, an IPv6 literal, or a subdomain
// wildcard with at least two labels after the star.
const FRAMEABLE_HOSTNAME_PATTERN =
  /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+|\*\.[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseFrameAncestorList(entries: readonly string[]): string[] {
  if (entries.length > MAX_FRAME_ANCESTORS) {
    throw new Error(
      `--frame-ancestor accepts at most ${MAX_FRAME_ANCESTORS} origins; received ${entries.length}. ` +
        'Keep only the origins that embed the preview.'
    );
  }
  return [...new Set(entries.map(parseFrameAncestor))];
}

function parseFrameAncestor(entry: string): string {
  const value = entry.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `--frame-ancestor ${entry} is not a URL. Pass the origin of the page that embeds the preview, ` +
        'such as https://app.example.com, or a subdomain wildcard such as https://*.example.com.'
    );
  }
  if (
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error(
      `--frame-ancestor ${entry} must be an origin only. Browsers match frame ancestors by scheme, ` +
        `host and port, so drop the path, query, hash and credentials: ${url.origin}.`
    );
  }
  const isLoopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(
      `--frame-ancestor ${entry} must use https. The preview is served over https, and browsers do ` +
        'not let an http page embed it. Plain http is accepted for localhost only.'
    );
  }
  if (!FRAMEABLE_HOSTNAME_PATTERN.test(url.hostname)) {
    throw new Error(
      `--frame-ancestor ${entry} has a host the preview host cannot allow. Use a hostname, an IPv6 ` +
        'literal, or a subdomain wildcard with at least two labels after the star, such as https://*.example.com.'
    );
  }
  return url.origin;
}
