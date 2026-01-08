import { spawnAsync } from '@expo/steps';
import { asyncResult } from '@expo/results';

import { turtleFetch } from '../../utils/turtleFetch';

export interface CcacheStats {
  cacheableCalls: number;
  cacheableCallsPercent: number;
  hitRatePercent: number;
  directHits: number;
  preprocessedHits: number;
  misses: number;
  cacheSizeGiB: number;
  cacheMaxSizeGiB: number;
  cacheSizePercent: number;
}

const REQUIRED_CCACHE_KEYS = [
  'direct_cache_hit',
  'preprocessed_cache_hit',
  'cache_miss',
  'cache_size_kibibyte',
  'max_cache_size_kibibyte',
] as const;

function parseCcacheStats(output: string): CcacheStats | null {
  // Parse key-value pairs from `ccache --print-stats` output
  const values: Record<string, number> = {};
  for (const line of output.split('\n')) {
    const [key, value] = line.split('\t');
    if (key && value) {
      values[key] = parseInt(value, 10);
    }
  }

  // Validate that required keys are present
  for (const key of REQUIRED_CCACHE_KEYS) {
    if (!(key in values)) {
      return null;
    }
  }

  const directHits = values['direct_cache_hit'];
  const preprocessedHits = values['preprocessed_cache_hit'];
  const misses = values['cache_miss'];
  const cacheSizeKiB = values['cache_size_kibibyte'];
  const maxCacheSizeKiB = values['max_cache_size_kibibyte'];

  // Uncacheable calls
  const calledForLink = values['called_for_link'] ?? 0;
  const couldNotUseModules = values['could_not_use_modules'] ?? 0;
  const calledForPreprocessing = values['called_for_preprocessing'] ?? 0;
  const uncacheableCalls = calledForLink + couldNotUseModules + calledForPreprocessing;

  // Calculate derived stats
  const cacheableCalls = directHits + preprocessedHits + misses;
  const totalCalls = cacheableCalls + uncacheableCalls;
  const cacheableCallsPercent = totalCalls > 0 ? (cacheableCalls / totalCalls) * 100 : 0;
  const hitRatePercent =
    cacheableCalls > 0 ? ((directHits + preprocessedHits) / cacheableCalls) * 100 : 0;

  // Convert KiB to GiB (1 GiB = 1024 * 1024 KiB)
  const KIB_PER_GIB = 1024 * 1024;
  const cacheSizeGiB = cacheSizeKiB / KIB_PER_GIB;
  const cacheMaxSizeGiB = maxCacheSizeKiB / KIB_PER_GIB;
  const cacheSizePercent = cacheMaxSizeGiB > 0 ? (cacheSizeGiB / cacheMaxSizeGiB) * 100 : 0;

  return {
    cacheableCalls,
    cacheableCallsPercent: Number(cacheableCallsPercent.toFixed(2)),
    hitRatePercent: Number(hitRatePercent.toFixed(2)),
    directHits,
    preprocessedHits,
    misses,
    cacheSizeGiB: Number(cacheSizeGiB.toFixed(2)),
    cacheMaxSizeGiB: Number(cacheMaxSizeGiB.toFixed(2)),
    cacheSizePercent: Number(cacheSizePercent.toFixed(2)),
  };
}

export async function sendCcacheStatsAsync({
  env,
  expoApiServerURL,
  robotAccessToken,
  buildId,
}: {
  env: Record<string, string | undefined>;
  expoApiServerURL: string;
  robotAccessToken: string;
  buildId: string;
}): Promise<void> {
  try {
    const result = await asyncResult(
      spawnAsync('ccache', ['--print-stats'], {
        env,
        stdio: 'pipe',
      })
    );
    if (!result.ok) {
      return;
    }
    const stats = parseCcacheStats(result.value.stdout);

    if (!stats) {
      return;
    }

    const payload = {
      buildId,
      ...stats,
    };
    await turtleFetch(new URL('v2/turtle-caches/stats', expoApiServerURL).toString(), 'POST', {
      json: payload,
      headers: {
        Authorization: `Bearer ${robotAccessToken}`,
        'Content-Type': 'application/json',
      },
      retries: 2,
      shouldThrowOnNotOk: true,
    });
  } catch {}
}
