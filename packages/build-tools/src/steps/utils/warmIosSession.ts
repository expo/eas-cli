import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { stopWarmSimulatorAsync } from '../../utils/warmSimulator';
import { turtleFetch } from '../../utils/turtleFetch';
import { type DetachedProcessHandle, isProcessRunning } from './remoteDeviceRunSession';
import { listAgentDeviceArtifactsAsync } from './agentDeviceArtifacts';

const STARTUP_SCRIPT = path.join(os.homedir(), '.expo/simulator-tools/run');
const SESSION_STATE_FILE = '/tmp/expo-simulator-startup.json';
const SERVE_SIM_STATE_DIRECTORY = 'serve-sim';
const ARGENT_STATE_DIR = path.join(os.homedir(), '.argent');
const SERVE_SIM_PORT = 3200;
const ARGENT_PORT = 3201;
const LOOPBACK_ORIGIN = 'http://127.0.0.1';
const SERVE_SIM_URL = `${LOOPBACK_ORIGIN}:${SERVE_SIM_PORT}`;

type ControllerIdentity = { controllerPid: number; controllerStartTime: string };
const ServiceStateSchema = z.object({
  pid: z.number().int().gt(1),
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1),
});
const ServeStateSchema = ServiceStateSchema.extend({ device: z.string(), url: z.string() });
const AgentStateSchema = z.object({
  pid: z.number().int().gt(1),
  httpPort: z.number().int().min(1).max(65535),
  token: z.string().min(1),
  version: z.string(),
  processStartTime: z.string(),
  stateDir: z.string(),
});
const ArgentStateSchema = ServiceStateSchema.extend({
  bundlePath: z.string(),
  version: z.string().optional(),
});
const ReadySchema = z.object({ status: z.literal('ready'), device: z.string() });
const DeviceSchema = z.object({ udid: z.string().trim().min(1), name: z.string().trim().min(1) });
/** Warm capture and selected tooling for this VM's job. */
export type WarmIosSession = {
  device: z.infer<typeof DeviceSchema>;
  serveSim: z.infer<typeof ServiceStateSchema>;
  tools?: z.infer<typeof ServiceStateSchema>;
  agentDeviceStateDir: string;
  argentEventLogPath: string;
  process: DetachedProcessHandle;
};

export { stopWarmSimulatorAsync as stopWarmIosSessionAsync } from '../../utils/warmSimulator';

function matchesRequestedPackageVersion(requested: string | undefined, actual: unknown): boolean {
  return !requested || requested === 'latest' || requested === actual;
}

async function readJsonAsync(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function isProcessOwnedByWarmSessionAsync(
  pid: unknown,
  controller: ControllerIdentity
): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 1) {
    return false;
  }
  for (let parent = pid as number, depth = 0; parent > 1 && depth < 32; depth++) {
    if (parent === controller.controllerPid) {
      const result = await spawn('ps', ['-p', String(parent), '-o', 'lstart='], {
        stdio: 'pipe',
      });
      return result.stdout.trim() === controller.controllerStartTime;
    }
    const result = await spawn('ps', ['-p', String(parent), '-o', 'ppid='], { stdio: 'pipe' });
    const value = result.stdout.trim();
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      return false;
    }
    parent = Number(value);
  }
  return false;
}

async function fetchWarmServiceJsonAsync(
  state: z.infer<typeof ServiceStateSchema>,
  port: number,
  controller: ControllerIdentity,
  route: string,
  signal?: AbortSignal
): Promise<unknown> {
  if (state.port !== port || !(await isProcessOwnedByWarmSessionAsync(state.pid, controller))) {
    throw new Error(
      'The warm service port or process does not match the Simulator launcher that started it.'
    );
  }
  return (
    await turtleFetch(`${LOOPBACK_ORIGIN}:${port}${route}`, 'GET', {
      headers: { Authorization: `Bearer ${state.token}` },
      retries: 0,
      timeout: 5_000,
      signal,
    })
  ).json();
}

async function preflightAgentDeviceAsync(
  agentDeviceStateDir: string,
  packageVersion?: string,
  signal?: AbortSignal
) {
  const state = AgentStateSchema.parse(
    await readJsonAsync(path.join(agentDeviceStateDir, 'daemon.json'))
  );
  // prepare starts a detached daemon, so PPID ancestry cannot identify it. Match its
  // native registration's process start time and isolated state directory instead.
  const processStart = (
    await spawn('ps', ['-p', String(state.pid), '-o', 'lstart='], { stdio: 'pipe' })
  ).stdout.trim();
  if (
    !processStart ||
    processStart !== state.processStartTime ||
    path.resolve(state.stateDir) !== path.resolve(agentDeviceStateDir)
  ) {
    throw new Error(
      'The warm agent-device process could not be verified: its start time or state directory does not match the saved state.'
    );
  }
  const tools = { pid: state.pid, port: state.httpPort, token: state.token };
  if (!matchesRequestedPackageVersion(packageVersion, state.version)) {
    throw new Error(
      "The warm agent-device version does not match the job's requested package_version."
    );
  }
  // This authenticated request verifies that the registered daemon accepts its token.
  await listAgentDeviceArtifactsAsync({
    daemonUrl: `${LOOPBACK_ORIGIN}:${tools.port}`,
    daemonToken: tools.token,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5_000)])
      : AbortSignal.timeout(5_000),
  });
  return tools;
}

async function preflightArgentAsync(
  controller: ControllerIdentity,
  packageVersion?: string,
  signal?: AbortSignal
) {
  for (const entry of await fs.readdir(ARGENT_STATE_DIR)) {
    if (!/^tool-server.*\.json$/.test(entry)) {
      continue;
    }
    const parsed = ArgentStateSchema.safeParse(
      await readJsonAsync(path.join(ARGENT_STATE_DIR, entry)).catch(() => null)
    );
    if (!parsed.success) {
      continue;
    }
    const state = parsed.data;
    // A file left by another Argent process can name the same port; only ours can fail adoption.
    if (
      state.port !== ARGENT_PORT ||
      !(await isProcessOwnedByWarmSessionAsync(state.pid, controller))
    ) {
      continue;
    }
    const pkg = z
      .object({ version: z.string() })
      .parse(await readJsonAsync(path.join(path.dirname(state.bundlePath), '../package.json')));
    if (!matchesRequestedPackageVersion(packageVersion, state.version ?? pkg.version)) {
      throw new Error(
        "The warm Argent version does not match the job's requested package_version."
      );
    }
    const response = await fetchWarmServiceJsonAsync(
      state,
      ARGENT_PORT,
      controller,
      '/tools',
      signal
    );
    if (!z.object({ tools: z.array(z.unknown()) }).safeParse(response).success) {
      throw new Error('The warm Argent server is missing or did not return its tool list.');
    }
    return { pid: state.pid, port: state.port, token: state.token };
  }
  throw new Error('The warm Argent server is missing or did not return its tool list.');
}

export async function tryClaimWarmIosSessionAsync({
  engine,
  requestedDevice,
  packageVersion,
  env,
  logger,
  signal,
}: {
  engine: 'serve-sim' | 'agent-device' | 'argent' | 'appium';
  requestedDevice?: string;
  packageVersion?: string;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<WarmIosSession | undefined> {
  if (env.EAS_USE_WARM_SIMULATOR !== '1') {
    return undefined;
  }
  let claiming = false;
  try {
    signal?.throwIfAborted();
    if (env.TMPDIR && path.resolve(env.TMPDIR) !== path.resolve(os.tmpdir())) {
      throw new Error(
        "The job's TMPDIR differs from the warm Simulator environment; normal startup requires cleanup first."
      );
    }
    const serveSimStateDirectory = path.join(os.tmpdir(), SERVE_SIM_STATE_DIRECTORY);
    if (
      env.SERVE_SIM_STATE_DIR &&
      path.resolve(env.SERVE_SIM_STATE_DIR) !== serveSimStateDirectory
    ) {
      throw new Error(
        "The job's SERVE_SIM_STATE_DIR differs from the warm Simulator environment; normal startup requires cleanup first."
      );
    }
    const unsupportedVariable = Object.keys(env).find(
      name => name === 'SERVE_SIM_ADDITIONAL_DYLIBS' || name.startsWith('SIMCTL_CHILD_')
    );
    if (unsupportedVariable) {
      throw new Error(
        `The job's ${unsupportedVariable} requires normal Simulator startup; the warm session must be cleaned up first.`
      );
    }
    const boot = (
      await spawn('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { stdio: 'pipe' })
    ).stdout.trim();
    if (!boot) {
      throw new Error('No warm Simulator session is available for this VM boot.');
    }
    const initialStatus = z
      .object({ bootUuid: z.literal(boot), status: z.literal('ready') })
      .safeParse(await readJsonAsync(SESSION_STATE_FILE));
    if (!initialStatus.success) {
      throw new Error('No warm Simulator session is available for this VM boot.', {
        cause: initialStatus.error,
      });
    }
    claiming = true;
    const result = await spawn(
      process.execPath,
      [
        STARTUP_SCRIPT,
        'claim',
        engine,
        ...(requestedDevice === undefined ? [] : [requestedDevice]),
      ],
      { logger, timeout: 425_000, signal }
    );
    signal?.throwIfAborted();
    const config = z
      .object({
        bootUuid: z.literal(boot),
        status: z.literal('claimed'),
        engine: z.literal(engine),
        device: DeviceSchema,
        controllerPid: z.number().int().gt(1),
        controllerStartTime: z.string().trim().min(1),
        agentDeviceStateDir: z.string().min(1),
        argentEventLogPath: z.string().min(1),
      })
      .parse(JSON.parse(result.stdout));
    claiming = false;
    const { device } = config;
    const { udid } = device;
    const serveState = ServeStateSchema.parse(
      await readJsonAsync(path.join(os.tmpdir(), SERVE_SIM_STATE_DIRECTORY, `server-${udid}.json`))
    );
    if (serveState.device.toUpperCase() !== udid.toUpperCase()) {
      throw new Error(
        `Warm serve-sim reports device ${serveState.device}, but claim returned ${udid}.`
      );
    }
    if (serveState.url !== SERVE_SIM_URL) {
      throw new Error(
        `The warm serve-sim address does not match ${SERVE_SIM_URL}; the session cannot be reused.`
      );
    }
    const ready = ReadySchema.parse(
      await fetchWarmServiceJsonAsync(serveState, SERVE_SIM_PORT, config, '/readyz', signal)
    );
    if (ready.device.toUpperCase() !== udid.toUpperCase()) {
      throw new Error(
        'The warm serve-sim server reports a different Simulator than the device handed over to this job.'
      );
    }
    const serveSim = { pid: serveState.pid, port: serveState.port, token: serveState.token };
    const { agentDeviceStateDir, argentEventLogPath } = config;
    const tools =
      engine === 'agent-device'
        ? await preflightAgentDeviceAsync(agentDeviceStateDir, packageVersion, signal)
        : engine === 'argent'
          ? await preflightArgentAsync(config, packageVersion, signal)
          : undefined;
    signal?.throwIfAborted();
    logger.info(`Claimed warm ${engine} on Simulator ${udid}.`);
    let stopping: Promise<void> | undefined;
    return {
      device,
      serveSim,
      tools,
      agentDeviceStateDir,
      argentEventLogPath,
      process: {
        pid: serveSim.pid,
        getOutput: () => '',
        getExitError: () =>
          isProcessRunning(serveSim.pid) && (!tools || isProcessRunning(tools.pid))
            ? undefined
            : new Error('A service required by the warm Simulator session has exited.'),
        stopAsync: () => (stopping ??= stopWarmSimulatorAsync(logger, env)),
      },
    };
  } catch (error) {
    logger.warn(
      { err: error },
      claiming
        ? 'Warm Simulator session claim did not complete; stopping its services. This claim will not be retried.'
        : 'The warm Simulator session cannot be used; cleanup is required before normal startup.'
    );
    await stopWarmSimulatorAsync(logger, env);
    signal?.throwIfAborted();
    if (claiming) {
      throw error;
    }
    return undefined;
  }
}
