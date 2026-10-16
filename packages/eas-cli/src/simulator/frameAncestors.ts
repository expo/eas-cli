/**
 * `--frame-ancestor` and `--cors-origin` values: origins of pages that may embed the simulator
 * preview host in a frame, or call its API cross-origin. The server applies the same rules;
 * checking here gives a fast, local error.
 */

export const MAX_FRAME_ANCESTORS = 10;
export const MAX_CORS_ORIGINS = 10;

// The shapes serve-sim and expo-device-hub accept: a host, an IPv6 literal, or a subdomain
// wildcard with at least two labels after the star.
const FRAMEABLE_HOSTNAME_PATTERN =
  /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+|\*\.[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseFrameAncestorList(entries: readonly string[]): string[] {
  return parseOriginList(entries, {
    flag: '--frame-ancestor',
    maxCount: MAX_FRAME_ANCESTORS,
    purpose: 'embeds the preview',
  });
}

export function parseCorsOriginList(entries: readonly string[]): string[] {
  return parseOriginList(entries, {
    flag: '--cors-origin',
    maxCount: MAX_CORS_ORIGINS,
    purpose: 'calls the preview API',
  });
}

function parseOriginList(
  entries: readonly string[],
  { flag, maxCount, purpose }: { flag: string; maxCount: number; purpose: string }
): string[] {
  if (entries.length > maxCount) {
    throw new Error(
      `${flag} accepts at most ${maxCount} origins; received ${entries.length}. ` +
        `Keep only the origins of pages that ${purpose}.`
    );
  }
  return [...new Set(entries.map(entry => parseOrigin(entry, flag, purpose)))];
}

function parseOrigin(entry: string, flag: string, purpose: string): string {
  const value = entry.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${flag} ${entry} is not a URL. Pass the origin of the page that ${purpose}, ` +
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
      `${flag} ${entry} must be an origin only. Browsers match origins by scheme, host and port, ` +
        `so drop the path, query, hash and credentials: ${url.origin}.`
    );
  }
  const isLoopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(
      `${flag} ${entry} must use https. The preview is served over https, and browsers do not ` +
        'let an http page use it. Plain http is accepted for localhost only.'
    );
  }
  if (!FRAMEABLE_HOSTNAME_PATTERN.test(url.hostname)) {
    throw new Error(
      `${flag} ${entry} has a host the preview host cannot allow. Use a hostname, an IPv6 ` +
        'literal, or a subdomain wildcard with at least two labels after the star, such as https://*.example.com.'
    );
  }
  return url.origin;
}
