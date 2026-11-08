import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  downloadExpoGoAsync,
  expoGoArchiveCacheDirectory,
  expoGoArchiveCachePath,
  extractCheckedExpoGoAsync,
  selectExpoGoAsync,
} from '../utils/expoGo';
import {
  agentDevicePackageSpec,
  argentPackageSpec,
  serveSimPackageSpec,
} from '../utils/packageSpecs';
import { commands } from '../utils/processes';

const PREFETCH_TIMEOUT_MS = 300_000;

/**
 * Caches pinned tool packages using a temporary install directory.
 * Stores and checks the Expo Go archive selected by start.
 */
export async function prefetchAsync(signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  // Cache only pinned packages. Unpinned tools resolve when started, as before.
  const toolSpecs = [
    readPins('serve-sim', ['SERVE_SIM_VERSION']) ? serveSimPackageSpec() : undefined,
    readPins('agent-device', ['AGENT_DEVICE_VERSION']) ? agentDevicePackageSpec() : undefined,
    readPins('Argent', ['ARGENT_VERSION']) ? argentPackageSpec() : undefined,
  ];
  // selectExpoGoAsync reads the pin itself. This check fails a bad value before any command or
  // download.
  readPins('Expo Go', ['EXPO_GO_SDK_VERSION']);
  const tmpdir = await mkdtemp(path.join(os.tmpdir(), 'simulator-launcher-prefetch-'));
  const environment = {
    TMPDIR: process.env.TMPDIR,
    APPIUM_HOME: process.env.APPIUM_HOME,
    npm_config_cache: process.env.npm_config_cache,
  };
  try {
    process.env.TMPDIR = tmpdir;
    if (toolSpecs.every(spec => !spec)) {
      process.stderr.write(
        'Skipping serve-sim, agent-device and Argent: SERVE_SIM_VERSION, AGENT_DEVICE_VERSION and ARGENT_VERSION are not set.\n'
      );
    }
    for (const spec of toolSpecs) {
      if (spec) {
        await prefetchStepAsync(
          spec,
          async signal =>
            (await commands.runOwnedAsync('bunx', [spec, '--version'], signal)).trim(),
          signal
        );
      }
    }
    await prefetchExpoGoAsync(tmpdir, signal);
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
  return 0;
}

async function prefetchExpoGoAsync(tmpdir: string, signal?: AbortSignal): Promise<void> {
  // A skipped step leaves no older archive.
  const directory = expoGoArchiveCacheDirectory();
  await rm(directory, { recursive: true, force: true });
  if (process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO === '0') {
    process.stderr.write('Skipping Expo Go: EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0.\n');
    return;
  }
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
      return `SDK ${sdk} from ${url}`;
    },
    signal
  );
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
