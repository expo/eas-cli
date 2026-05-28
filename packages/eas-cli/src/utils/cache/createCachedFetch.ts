// Ported from @expo/cli.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/api/rest/client.ts#L160-L190
//
// Adapted for eas-cli:
//   - The default fetch is eas-cli's `src/fetch.ts` (node-fetch + proxy agent +
//     `RequestError` on HTTP >= 400). Upstream defaults to its own multi-layer fetch
//     (offline → baseURL → credentials → progress), which eas-cli's fetch doesn't need
//     for the Expo Go download flow.
//   - `EXPO_NO_CACHE` and `EXPO_BETA` are read directly from `process.env`. Upstream
//     reads them through `@expo/cli`'s `env` helper; eas-cli doesn't have an equivalent,
//     so we inline a small `boolish` parser with the same truthy-value semantics.

import path from 'path';

import { FileSystemResponseCache } from './FileSystemResponseCache';
import { type FetchLike, wrapFetchWithCache } from './wrapFetchWithCache';
import defaultFetch from '../../fetch';
import { getExpoHomeDirectory } from '../paths';

function boolish(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'no';
}

/**
 * Create an instance of fetch with a `FileSystemResponseCache` rooted under
 * `~/.expo/<cacheDirectory>`. Caching is disabled automatically if `EXPO_NO_CACHE` or
 * `EXPO_BETA` is set, matching upstream behavior.
 */
export function createCachedFetch({
  fetch = defaultFetch,
  cacheDirectory,
  ttl,
  skipCache,
}: {
  fetch?: FetchLike;
  cacheDirectory: string;
  ttl?: number;
  skipCache?: boolean;
}): FetchLike {
  if (skipCache || boolish(process.env.EXPO_BETA) || boolish(process.env.EXPO_NO_CACHE)) {
    return fetch;
  }

  return wrapFetchWithCache(
    fetch,
    new FileSystemResponseCache({
      cacheDirectory: path.join(getExpoHomeDirectory(), cacheDirectory),
      ttl,
    })
  );
}
