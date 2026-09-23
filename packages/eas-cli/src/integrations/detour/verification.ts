import Log from '../../log';

export type LinkVerification = {
  assetlinks: { served: boolean; packageName?: string; fingerprints: string[] };
  aasa: { served: boolean; appIds: string[] };
};

/** The two files the operating systems fetch. Both public, so no auth needed. */
export async function fetchLinkVerificationAsync(linkHost: string): Promise<LinkVerification> {
  const [assetlinks, aasa] = await Promise.all([
    fetchJsonAsync(`https://${linkHost}/.well-known/assetlinks.json`),
    fetchJsonAsync(`https://${linkHost}/.well-known/apple-app-site-association`),
  ]);

  const firstTarget = Array.isArray(assetlinks) ? assetlinks[0]?.target : undefined;
  const details = aasa?.applinks?.details;

  return {
    assetlinks: {
      served: Boolean(firstTarget?.package_name),
      packageName: firstTarget?.package_name,
      fingerprints: firstTarget?.sha256_cert_fingerprints ?? [],
    },
    aasa: {
      served: Array.isArray(details) && details.length > 0,
      appIds: Array.isArray(details)
        ? details.map((detail: { appID?: string }) => detail.appID ?? '?')
        : [],
    },
  };
}

// The link host is not ours, so a black hole must not hang the command.
const WELL_KNOWN_TIMEOUT_MS = 5_000;

async function fetchJsonAsync(url: string): Promise<any> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(WELL_KNOWN_TIMEOUT_MS) });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    Log.debug(error);
    return null;
  }
}
