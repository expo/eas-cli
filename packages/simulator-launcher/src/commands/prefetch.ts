import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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

type PreparedTool =
  | { version: string; home: string; xcuitest: string }
  | { sdk: string; url: string };

/** Store the selected Expo Go archive and pinned Appium/XCUITest/WDA files without booting devices. */
export async function prefetchAsync(signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  const [appiumVersion = '', xcuitestVersion = ''] =
    readPins('Appium', ['APPIUM_VERSION', 'XCUITEST_VERSION']) ?? [];
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
    APPIUM_HOME: process.env.APPIUM_HOME,
    npm_config_cache: process.env.npm_config_cache,
  };
  try {
    process.env.TMPDIR = tmpdir;
    const expoGo = await prefetchExpoGoAsync(tmpdir, signal);
    if (expoGo) {
      manifest.tools['expo-go'] = expoGo;
    }
    const appium = await prefetchAppiumAsync(tmpdir, appiumVersion, xcuitestVersion, signal);
    if (appium) {
      manifest.tools.appium = appium;
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

async function prefetchAppiumAsync(
  tmpdir: string,
  appiumVersion: string,
  xcuitestVersion: string,
  signal?: AbortSignal
): Promise<{ version: string; xcuitest: string; home: string } | undefined> {
  // Build-tools reads this home (startAppiumRemoteSession.ts). README: "Prepared files".
  const home = path.join(os.homedir(), 'Library', 'Caches', 'expo-simulator-startup', 'appium');
  const appium = path.join(home, 'node_modules', '.bin', 'appium');
  const wda = path.join(home, 'preinstalled-wda');
  // A skipped step leaves no older home, so build-tools then installs as before.
  await rm(home, { recursive: true, force: true });
  if (!appiumVersion) {
    process.stderr.write('Skipping Appium: APPIUM_VERSION and XCUITEST_VERSION are not set.\n');
    return;
  }
  try {
    await mkdir(home, { recursive: true });
    // The same package.json as the job-time home in build-tools.
    await writeFile(
      path.join(home, 'package.json'),
      `${JSON.stringify({ name: 'eas-appium-home', private: true })}\n`
    );
    Object.assign(process.env, {
      APPIUM_HOME: home,
      npm_config_cache: path.join(tmpdir, 'npm-cache'),
    });
    await prefetchStepAsync(
      `appium@${appiumVersion}`,
      async signal => {
        await commands.runOwnedAsync(
          'npm',
          ['install', '--no-audit', '--save-exact', '--prefix', home, `appium@${appiumVersion}`],
          signal
        );
      },
      signal
    );
    await prefetchStepAsync(
      `xcuitest@${xcuitestVersion}`,
      async signal => {
        await commands.runOwnedAsync(
          appium,
          ['driver', 'install', `xcuitest@${xcuitestVersion}`],
          signal
        );
      },
      signal
    );
    await prefetchStepAsync(
      'WebDriverAgent',
      async signal => {
        await commands.runOwnedAsync(
          appium,
          [
            'driver',
            'run',
            'xcuitest',
            'download-wda',
            '--',
            '--outdir',
            wda,
            '--platform',
            'iOS',
            '--kind',
            'sim',
          ],
          signal
        );
        if (!(await stat(path.join(wda, 'WebDriverAgentRunner-Runner.app'))).isDirectory()) {
          throw new Error('WebDriverAgentRunner-Runner.app is not a directory.');
        }
      },
      signal
    );
    return { version: appiumVersion, xcuitest: xcuitestVersion, home };
  } catch (error) {
    commands.throwIfCommandCloseTimedOut();
    await rm(home, { recursive: true, force: true });
    throw error;
  }
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
