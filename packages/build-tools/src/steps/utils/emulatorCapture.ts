import { UserError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { type BuildStepEnv, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { installIsolatedNpmPackageAsync } from '../../utils/installIsolatedNpmPackageAsync';
import { sleepAsync } from '../../utils/retry';

// Experimental emulator capture. The Android Emulator preloads the expo-emulator-capture agent,
// which serves the emulator screen as H.264 on a Unix socket. expo-device-hub then streams the
// screen from that socket. The step input names the npm version of the agent, and build-tools
// asks the installed package where its library is. So a new agent release needs no change in
// build-tools or in the backend, while the agent keeps its environment variables and the Hub
// keeps finding sockets as `<TMPDIR>/expo-emulator-capture/<serial>.sock`.

const PACKAGE_NAME = 'expo-emulator-capture';
/** An exact npm version or a dist-tag. eas-cli and www check the same pattern. */
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/;
/** The registry normally answers in seconds; a stalled install must not hold the emulator. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;
/** The console ports that adb scans. An emulator also uses the next port, for adb. */
const FIRST_CONSOLE_PORT = 5554;
const LAST_CONSOLE_PORT = 5584;
/** The agent opens its socket while the emulator boots, so it is there soon after the boot. */
const SOCKET_TIMEOUT_MS = 10_000;
const SOCKET_POLL_MS = 500;
const LOG_TAIL_LINES = 20;
const HUB_CAPTURE_ENV = 'EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE';

/**
 * The renderer for an emulator whose session requested the capture: the Linux agent kept 60 fps
 * with lavapipe. As in expo-device-hub, it depends only on the request, not on the install, so a
 * failed install does not also change the renderer.
 */
export const EMULATOR_CAPTURE_RENDERER_ARGS = ['-gpu', 'lavapipe'];

/** Where the emulator start tells the session host which emulator has the agent socket. */
export const EMULATOR_CAPTURE_HANDOFF_PATH = path.join(
  os.tmpdir(),
  'eas-expo-emulator-capture.json'
);

export type EmulatorCapture = {
  version: string;
  /** The agent library that the emulator preloads. */
  library: string;
  /**
   * The TMPDIR of expo-device-hub. The Hub finds the agent sockets in its
   * `expo-emulator-capture` subdirectory, as `<serial>.sock`.
   */
  temporaryDirectory: string;
};

export type EmulatorCaptureLaunch = {
  /** The adb serial that the console port gives the emulator. */
  serialId: string;
  /** Emulator arguments, before $ANDROID_EMULATOR_EXTRA_ARGS. */
  args: string[];
  env: Record<string, string>;
  socketPath: string;
  logPath: string;
};

export type EmulatorCaptureHandoff = EmulatorCapture & {
  /** The emulator whose agent opened its socket. */
  serialId: string;
};

export function createExperimentalEmulatorCaptureVersionInputProvider(): ReturnType<
  typeof BuildStepInput.createProvider
> {
  return BuildStepInput.createProvider({
    id: 'experimental_emulator_capture_version',
    required: false,
    allowedValueTypeName: BuildStepInputValueTypeName.STRING,
  });
}

/** The expo-emulator-capture version to preload, or undefined when the capture is off. */
export function parseExperimentalEmulatorCaptureVersionInput(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new UserError(
      'EAS_EMULATOR_CAPTURE_INVALID_VERSION',
      `experimental_emulator_capture_version must be an exact npm version or a dist-tag of ${PACKAGE_NAME}.`
    );
  }
  return value;
}

/**
 * Installs the agent package. Returns null after a warning when the agent cannot run on this
 * host or the install fails. The emulator then starts without the agent, and expo-device-hub
 * streams without the capture.
 */
export async function installEmulatorCaptureAsync({
  version,
  env,
  logger,
}: {
  version: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<EmulatorCapture | null> {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    logger.warn(
      `The experimental emulator capture runs only on Linux x86-64 hosts. The emulator starts without ${PACKAGE_NAME}.`
    );
    return null;
  }
  const temporaryDirectory = os.tmpdir();
  try {
    const directory = await fs.promises.mkdtemp(
      path.join(temporaryDirectory, 'eas-emulator-capture-package-')
    );
    logger.info(`Installing ${PACKAGE_NAME}@${version} for the experimental emulator capture.`);
    await installIsolatedNpmPackageAsync({
      packageSpec: `${PACKAGE_NAME}@${version}`,
      directory,
      npmCacheUrl: env.EAS_BUILD_NPM_CACHE_URL,
      pathEnv: env.PATH,
      logger,
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    });
    const library = await resolveAgentLibraryAsync({ directory, env });
    if (!path.isAbsolute(library) || !fs.existsSync(library)) {
      throw new Error(`${PACKAGE_NAME}@${version} has no Linux x86-64 agent at "${library}".`);
    }
    await ensurePrivateDirectoryAsync(getSocketDirectory(temporaryDirectory));
    return { version, library, temporaryDirectory };
  } catch (err) {
    logger.warn(
      { err },
      `Could not install ${PACKAGE_NAME}@${version}. The emulator starts without it.`
    );
    return null;
  }
}

/** The arguments and environment that preload the agent into one emulator. */
export async function prepareEmulatorCaptureLaunchAsync({
  capture,
  env,
}: {
  capture: EmulatorCapture;
  env: BuildStepEnv;
}): Promise<EmulatorCaptureLaunch> {
  const port = await findAvailableConsolePortAsync();
  const serialId = `emulator-${port}`;
  const socketPath = getSocketPath(capture.temporaryDirectory, serialId);
  const logPath = path.join(getSocketDirectory(capture.temporaryDirectory), `${serialId}.log`);
  // No emulator uses this port now, so a socket or log here is from an earlier emulator. A stale
  // socket would look like the agent's socket after the boot.
  await Promise.all([socketPath, logPath].map(file => fs.promises.rm(file, { force: true })));
  return {
    serialId,
    // build-tools names the socket by the serial, which comes from the console port, because the
    // Hub looks for it by serial. So the port must be known before the start.
    args: ['-port', String(port)],
    env: {
      // A library that the job already preloads stays preloaded, after the agent.
      LD_PRELOAD: [capture.library, env.LD_PRELOAD].filter(Boolean).join(':'),
      EXPO_EMULATOR_CAPTURE_SOCKET: socketPath,
      EXPO_EMULATOR_CAPTURE_LOG: logPath,
    },
    socketPath,
    logPath,
  };
}

/**
 * Tells the session host about the agent of a booted emulator, when the agent opened its
 * socket. Otherwise logs why not, and expo-device-hub streams without the capture.
 */
export async function finishEmulatorCaptureAsync({
  capture,
  launch,
  serialId,
  logger,
  handoffPath = EMULATOR_CAPTURE_HANDOFF_PATH,
  socketTimeoutMs = SOCKET_TIMEOUT_MS,
}: {
  capture: EmulatorCapture;
  launch: EmulatorCaptureLaunch;
  serialId: string;
  logger: bunyan;
  handoffPath?: string;
  socketTimeoutMs?: number;
}): Promise<void> {
  if (serialId !== launch.serialId) {
    logger.warn(
      `The emulator runs as ${serialId}, not as ${launch.serialId}, so expo-device-hub cannot find the socket of its capture agent. Do not set -port in $ANDROID_EMULATOR_EXTRA_ARGS.`
    );
    return;
  }
  const deadline = Date.now() + socketTimeoutMs;
  while (!(await isSocketAsync(launch.socketPath)) && Date.now() < deadline) {
    await sleepAsync(SOCKET_POLL_MS);
  }
  if (!(await isSocketAsync(launch.socketPath))) {
    const log = await readLogTailAsync(launch.logPath);
    logger.warn(
      `The capture agent in ${serialId} did not open ${launch.socketPath}. The session streams without ${PACKAGE_NAME}.${
        log ? `\nAgent log (${launch.logPath}):\n${log}` : ''
      }`
    );
    return;
  }
  const handoff: EmulatorCaptureHandoff = { ...capture, serialId };
  try {
    await fs.promises.writeFile(handoffPath, JSON.stringify(handoff), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (err) {
    logger.warn(
      { err },
      `Could not record the capture agent of ${serialId}. The session streams without ${PACKAGE_NAME}.`
    );
    return;
  }
  logger.info(
    `The ${PACKAGE_NAME}@${capture.version} agent in ${serialId} opened ${launch.socketPath} (experimental).`
  );
}

/** Removes the record of an earlier emulator start, so a session never reads a stale one. */
export async function clearEmulatorCaptureHandoffAsync({
  logger,
  handoffPath = EMULATOR_CAPTURE_HANDOFF_PATH,
}: {
  logger: bunyan;
  handoffPath?: string;
}): Promise<void> {
  try {
    await fs.promises.rm(handoffPath, { force: true });
  } catch (err) {
    logger.warn({ err }, `Could not remove ${handoffPath}.`);
  }
}

/**
 * The capture environment for expo-device-hub. When the emulator start recorded an agent whose
 * socket is still there, it turns the capture on. Otherwise it turns the capture off, so a Hub
 * whose capture is on by default does not try to attach an agent with a debugger; a value in the
 * job env then stays. An expo-device-hub version without the capture ignores this environment.
 */
export async function readEmulatorCaptureHubEnvAsync({
  env,
  logger,
  hubPackageSpec,
  handoffPath = EMULATOR_CAPTURE_HANDOFF_PATH,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  /** For the log: the Hub that gets the environment. */
  hubPackageSpec: string;
  handoffPath?: string;
}): Promise<Record<string, string>> {
  const off: Record<string, string> =
    env[HUB_CAPTURE_ENV] === undefined ? { [HUB_CAPTURE_ENV]: '0' } : {};
  const handoff = await readEmulatorCaptureHandoffAsync(handoffPath).catch(err => {
    logger.warn({ err }, `Could not read ${handoffPath}. The session streams without the capture.`);
    return null;
  });
  if (!handoff) {
    return off;
  }
  const socketPath = getSocketPath(handoff.temporaryDirectory, handoff.serialId);
  if (!(await isSocketAsync(socketPath))) {
    logger.warn(
      `${handoff.serialId} has no capture agent socket at ${socketPath} any more. The session streams without ${PACKAGE_NAME}.`
    );
    return off;
  }
  if (!fs.existsSync(handoff.library)) {
    logger.warn(
      `The capture agent library ${handoff.library} is gone. The session streams without ${PACKAGE_NAME}.`
    );
    return off;
  }
  logger.info(
    `Turning on the experimental emulator capture for ${handoff.serialId} (${PACKAGE_NAME}@${handoff.version}). ${hubPackageSpec} ignores it if that version has no emulator capture.`
  );
  return {
    [HUB_CAPTURE_ENV]: '1',
    EXPO_DEVICE_HUB_EMULATOR_CAPTURE_LIBRARY: handoff.library,
    TMPDIR: handoff.temporaryDirectory,
  };
}

/** Asks the installed package for its Linux agent library, through its public `paths` export. */
async function resolveAgentLibraryAsync({
  directory,
  env,
}: {
  directory: string;
  env: BuildStepEnv;
}): Promise<string> {
  const { stdout } = await spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { agentLibraryPath } from '${PACKAGE_NAME}/paths'; process.stdout.write(agentLibraryPath('linux'));`,
    ],
    // The bare import resolves from the working directory, which holds the install.
    { cwd: directory, env: { PATH: env.PATH } }
  );
  return stdout.trim();
}

async function readEmulatorCaptureHandoffAsync(
  handoffPath: string
): Promise<EmulatorCaptureHandoff | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(handoffPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<EmulatorCaptureHandoff>;
  if (
    typeof parsed.version !== 'string' ||
    typeof parsed.library !== 'string' ||
    typeof parsed.temporaryDirectory !== 'string' ||
    typeof parsed.serialId !== 'string'
  ) {
    throw new Error(`The emulator capture handoff at ${handoffPath} is malformed.`);
  }
  return {
    version: parsed.version,
    library: parsed.library,
    temporaryDirectory: parsed.temporaryDirectory,
    serialId: parsed.serialId,
  };
}

function getSocketDirectory(temporaryDirectory: string): string {
  return path.join(temporaryDirectory, 'expo-emulator-capture');
}

function getSocketPath(temporaryDirectory: string, serialId: string): string {
  return path.join(getSocketDirectory(temporaryDirectory), `${serialId}.sock`);
}

/**
 * The directory holds the sockets and the agent logs, so only this user may own or write it,
 * as expo-device-hub also requires. On a shared /tmp, another user could create it first.
 */
async function ensurePrivateDirectoryAsync(directory: string): Promise<void> {
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.promises.lstat(directory);
  const uid = process.getuid?.();
  if (!info.isDirectory() || (uid !== undefined && info.uid !== uid) || (info.mode & 0o077) !== 0) {
    throw new Error(`${directory} must be a directory that only this user can access (mode 0700).`);
  }
}

/** Whether a socket file is there. It does not connect: the agent serves one consumer at a time. */
async function isSocketAsync(socketPath: string): Promise<boolean> {
  try {
    return (await fs.promises.lstat(socketPath)).isSocket();
  } catch {
    return false;
  }
}

async function readLogTailAsync(logPath: string): Promise<string> {
  try {
    const text = await fs.promises.readFile(logPath, 'utf8');
    return text.trimEnd().split('\n').slice(-LOG_TAIL_LINES).join('\n');
  } catch {
    return '';
  }
}

export async function findAvailableConsolePortAsync(): Promise<number> {
  for (let port = FIRST_CONSOLE_PORT; port <= LAST_CONSOLE_PORT; port += 2) {
    if ((await isPortAvailableAsync(port)) && (await isPortAvailableAsync(port + 1))) {
      return port;
    }
  }
  throw new Error(
    `No emulator console port from ${FIRST_CONSOLE_PORT} to ${LAST_CONSOLE_PORT} is free.`
  );
}

async function isPortAvailableAsync(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
