import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  downloadExpoGoAsync,
  expoGoArchiveCacheDirectory,
  expoGoArchiveCachePath,
  extractCheckedExpoGoAsync,
  selectExpoGoAsync,
} from '../utils/expoGo';
import { commands } from '../utils/processes';

const PREFETCH_TIMEOUT_MS = 300_000;

type PreparedTool = { sdk: string; url: string };

/** Store the selected Expo Go archive without booting devices. */
export async function prefetchAsync(signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  // selectExpoGoAsync reads the pin itself. This check fails a bad value before any command or
  // download.
  if (process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO !== '0') {
    readPins('Expo Go', ['EXPO_GO_SDK_VERSION']);
  }
  const manifestPath = path.join(
    os.homedir(),
    'Library',
    'Caches',
    'expo-simulator-startup',
    'prepared.json'
  );
  const manifest: { tools: Record<string, PreparedTool> } = {
    tools: {},
  };
  // A new preparation attempt must not advertise an earlier set of versions.
  await rm(manifestPath, { force: true });
  const tmpdir = await mkdtemp(path.join(os.tmpdir(), 'simulator-launcher-prefetch-'));
  const environment = {
    TMPDIR: process.env.TMPDIR,
  };
  try {
    process.env.TMPDIR = tmpdir;
    const expoGo = await prefetchExpoGoAsync(tmpdir, signal);
    if (expoGo) {
      manifest.tools['expo-go'] = expoGo;
    }
  } finally {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    commands.throwIfCommandCloseTimedOut();
    await rm(tmpdir, { recursive: true, force: true });
  }
  signal?.throwIfAborted();
  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    signal?.throwIfAborted();
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    signal?.throwIfAborted();
  } catch (error) {
    await rm(manifestPath, { force: true });
    throw error;
  }
  return 0;
}

async function prefetchExpoGoAsync(
  tmpdir: string,
  signal?: AbortSignal
): Promise<{ sdk: string; url: string } | undefined> {
  // A skipped step leaves no older archive.
  const directory = expoGoArchiveCacheDirectory();
  await rm(directory, { recursive: true, force: true });
  if (process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO === '0') {
    process.stderr.write('Skipping Expo Go: EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0.\n');
    return;
  }
  let prepared: { sdk: string; url: string } | undefined;
  await prefetchStepAsync(
    'Expo Go',
    async signal => {
      // The same selection as start, so start finds this file while the release is current.
      const { sdk, url } = await selectExpoGoAsync(signal);
      const file = expoGoArchiveCachePath(url);
      try {
        await mkdir(directory, { recursive: true });
        await downloadExpoGoAsync(url, file, signal);
        await extractCheckedExpoGoAsync(
          file,
          path.join(tmpdir, 'ExpoGo.app'),
          signal,
          (file, args) => commands.runOwnedAsync(file, args, signal)
        );
      } catch (error) {
        commands.throwIfCommandCloseTimedOut();
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      prepared = { sdk, url };
      return `SDK ${sdk} from ${url}`;
    },
    signal
  );
  return prepared;
}

/** Returns the exact (x.y.z) versions in these variables, or undefined when none is set. */
function readPins(name: string, variables: string[]): string[] | undefined {
  const versions = variables.map(variable => process.env[variable] ?? '');
  if (versions.every(version => !version)) {
    return undefined;
  }
  if (!versions.every(version => /^\d+\.\d+\.\d+$/.test(version))) {
    throw new Error(
      variables.length === 1
        ? `Could not prefetch ${name}: set ${variables[0]} to an exact version (x.y.z), or leave it unset.`
        : `Could not prefetch ${name}: set all of ${variables.join(', ')} to exact versions (x.y.z), or none of them.`
    );
  }
  return versions;
}

/** Runs one step with its own timeout. Progress goes to stderr; stdout stays empty. */
async function prefetchStepAsync(
  name: string,
  run: (signal: AbortSignal) => Promise<string | void>,
  parentSignal?: AbortSignal
): Promise<void> {
  process.stderr.write(`Prefetching ${name}.\n`);
  const timeout = AbortSignal.timeout(PREFETCH_TIMEOUT_MS);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
  let detail: string | void;
  try {
    detail = await run(signal);
  } catch (error) {
    if (timeout.aborted) {
      throw new Error(`Could not prefetch ${name} within ${PREFETCH_TIMEOUT_MS / 1000} seconds.`, {
        cause: error,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not prefetch ${name}: ${message}`, { cause: error });
  }
  process.stderr.write(`Prefetched ${name}${detail ? ` (${detail})` : ''}.\n`);
}
