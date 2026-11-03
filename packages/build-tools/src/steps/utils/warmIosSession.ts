import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { runSimulatorLauncherAsync, stopWarmSimulatorAsync } from '../../utils/warmSimulator';
import { readLocalEgressHandoffAsync } from './localEgress';
import { type DetachedProcessHandle, isProcessRunning } from './remoteDeviceRunSession';

const ServiceSchema = z.object({ pid: z.number(), port: z.number(), token: z.string() });
const ClaimSchema = z.object({
  device: z.object({ udid: z.string(), name: z.string() }),
  server: ServiceSchema,
  agentDeviceStateDir: z.string(),
  argentEventLogPath: z.string(),
  preinstalledExpoGo: z
    .object({ bundleIdentifier: z.string(), shortVersion: z.string(), version: z.string() })
    .optional(),
});

type Service = z.infer<typeof ServiceSchema>;

/** The warm Simulator that the launcher handed to this job. */
export type WarmIosSession = z.infer<typeof ClaimSchema> & {
  /** The selected tool's server; set by prepareToolsAsync. */
  tools?: Service;
  /** Runs after adoption: the launcher prepares the selected tool for the adopted device. */
  prepareToolsAsync(signal?: AbortSignal): Promise<void>;
  process: DetachedProcessHandle;
};

/**
 * Claims the warm Simulator. The launcher checks the session; build-tools only uses it. On any
 * failure, warmup stops and the caller uses a cold start; a failed stop rejects.
 */
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
  try {
    // Warm tools run the latest release with the VM's Simulator settings.
    if (packageVersion && packageVersion !== 'latest') {
      throw new Error('A pinned package_version needs a cold start.');
    }
    const setting = Object.keys(env).find(
      name => name === 'SERVE_SIM_ADDITIONAL_DYLIBS' || name.startsWith('SIMCTL_CHILD_')
    );
    if (setting) {
      throw new Error(`${setting} needs a cold start.`);
    }
    if (await readLocalEgressHandoffAsync()) {
      throw new Error('A local egress session needs a cold start.');
    }
    const claimArgs = ['claim', engine, ...(requestedDevice ? [requestedDevice] : [])];
    const claim = ClaimSchema.parse(
      JSON.parse(await runSimulatorLauncherAsync(claimArgs, { env, signal }))
    );
    logger.info(`Claimed the warm Simulator ${claim.device.name} (${claim.device.udid}).`);
    let stopping: Promise<void> | undefined;
    const session: WarmIosSession = {
      ...claim,
      async prepareToolsAsync(prepareSignal = signal) {
        const prepared = ClaimSchema.pick({ preinstalledExpoGo: true })
          .extend({ tools: ServiceSchema.optional() })
          .parse(
            JSON.parse(
              await runSimulatorLauncherAsync(['prepare-tools'], { env, signal: prepareSignal })
            )
          );
        // The launcher reports the Expo Go it preinstalled once its install has finished.
        session.preinstalledExpoGo = prepared.preinstalledExpoGo ?? session.preinstalledExpoGo;
        if (engine === 'agent-device') {
          const daemon = z
            .object({ pid: z.number(), httpPort: z.number(), token: z.string() })
            .parse(await readJsonAsync(path.join(claim.agentDeviceStateDir, 'daemon.json')));
          session.tools = { pid: daemon.pid, port: daemon.httpPort, token: daemon.token };
        } else if (engine === 'argent') {
          session.tools = ServiceSchema.parse(prepared.tools);
        }
      },
      process: {
        pid: claim.server.pid,
        getOutput: () => '',
        getExitError: () =>
          isProcessRunning(claim.server.pid) &&
          (!session.tools || isProcessRunning(session.tools.pid))
            ? undefined
            : new Error('A service of the warm Simulator session has exited.'),
        stopAsync: () => (stopping ??= stopWarmSimulatorAsync(env)),
      },
    };
    return session;
  } catch (error) {
    logger.warn({ err: error }, 'Could not use the warm Simulator; stopping it for a cold start.');
    await stopWarmSimulatorAsync(env);
    signal?.throwIfAborted();
    return undefined;
  }
}

async function readJsonAsync(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
