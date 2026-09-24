import { DeviceRunSession } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAgentDevicePackageSpec } from '../../steps/functions/startAgentDeviceRemoteSession';
import {
  installAppiumAsync,
  resolveAppium3VersionSpec,
  resolveAppiumDriverName,
} from '../../steps/functions/startAppiumRemoteSession';
import { ARGENT_PACKAGE_NAME } from '../../steps/functions/startArgentRemoteSession';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageAdd,
} from '../../utils/packageManager';
import { type SessionRuntime, type SessionTask, type SessionTaskContext } from '../runtime';

export const PREFETCH_TOOLING_TASK_ID = 'prefetch_tooling';

const SERVE_SIM_PACKAGE_NAME = '@expo/serve-sim';
const EXPO_DEVICE_HUB_PACKAGE_NAME = 'expo-device-hub';

/**
 * Resolves and caches the controller and preview packages while the device
 * boots, so the tasks that start them find the packages installed. Every part is
 * best effort: a failure here only means the start task fetches the package
 * itself, as it does today.
 *
 * Each package is warmed with the package manager its start task resolves
 * (`EAS_OVERRIDE_PACKAGE_MANAGER`, then `EAS_FALLBACK_PACKAGE_MANAGER`, then the
 * tool's default), so the prefetch fills the cache that the start reads.
 */
export function createPrefetchToolingTask(): SessionTask {
  return {
    id: PREFETCH_TOOLING_TASK_ID,
    displayName: 'Prefetch session tooling',
    onFailure: 'warn',
    run: async context => {
      const jobs = planPrefetches(context.runtime).map(async ({ description, run }) => {
        context.logger.info(`Prefetching ${description}.`);
        try {
          await run(context);
        } catch (err) {
          throw new Error(`Could not prefetch ${description}: ${errorMessage(err)}`, {
            cause: err,
          });
        }
      });
      const failures = (await Promise.allSettled(jobs)).flatMap(result =>
        result.status === 'rejected' ? [result.reason as Error] : []
      );
      if (failures.length > 0) {
        throw new Error(failures.map(failure => failure.message).join('\n'));
      }
    },
  };
}

type Prefetch = {
  description: string;
  run: (context: SessionTaskContext) => Promise<void>;
};

function planPrefetches(runtime: SessionRuntime): Prefetch[] {
  const { controller, packageVersion } = runtime.session;
  const prefetches: Prefetch[] = [];

  // The web preview is served by serve-sim on macOS and expo-device-hub on Linux.
  // Only web-preview-only sessions pin its version; other controllers preview with latest.
  const previewVersion =
    controller === DeviceRunSession.Controller.WEB_PREVIEW_ONLY ? packageVersion : undefined;
  const previewPackageName =
    runtime.runtimePlatform === BuildRuntimePlatform.DARWIN
      ? SERVE_SIM_PACKAGE_NAME
      : EXPO_DEVICE_HUB_PACKAGE_NAME;
  const previewPackageSpec = `${previewPackageName}@${previewVersion ?? 'latest'}`;
  prefetches.push({
    description: previewPackageSpec,
    run: async ({ runtime, logger }) => {
      // Matches startWebPreviewWithTunnelAsync, which runs the preview through this manager.
      await warmPackageExecCacheAsync({
        packageManager: resolveConfiguredPackageManager(runtime.env, PackageManager.NPM),
        packageSpec: previewPackageSpec,
        env: runtime.env,
        logger,
      });
    },
  });

  switch (controller) {
    case DeviceRunSession.Controller.AGENT_DEVICE: {
      const spec = createAgentDevicePackageSpec(packageVersion);
      prefetches.push({
        description: spec,
        run: async ({ runtime, logger }) => {
          // The controller start installs the package into a fresh directory with this
          // manager; installing it once here fills the manager's package cache.
          await warmPackageAddCacheAsync({
            packageManager: resolveConfiguredPackageManager(runtime.env, PackageManager.BUN),
            packageSpec: spec,
            env: runtime.env,
            logger,
          });
        },
      });
      break;
    }
    case DeviceRunSession.Controller.ARGENT: {
      const spec = `${ARGENT_PACKAGE_NAME}@${packageVersion ?? 'latest'}`;
      prefetches.push({
        description: spec,
        run: async ({ runtime, logger }) => {
          // Matches startArgentControllerAsync, which runs Argent through this manager.
          await warmPackageExecCacheAsync({
            packageManager: resolveConfiguredPackageManager(runtime.env, PackageManager.BUN),
            packageSpec: spec,
            env: runtime.env,
            logger,
          });
        },
      });
      break;
    }
    case DeviceRunSession.Controller.APPIUM: {
      const versionSpec = resolveAppium3VersionSpec(packageVersion);
      prefetches.push({
        description: `appium@${versionSpec}`,
        run: async ({ runtime, logger }) => {
          runtime.state.appiumInstallation = await installAppiumAsync({
            versionSpec,
            driverName: resolveAppiumDriverName(runtime.runtimePlatform),
            env: runtime.env,
            logger,
          });
        },
      });
      break;
    }
    case DeviceRunSession.Controller.WEB_PREVIEW_ONLY:
      break;
  }

  return prefetches;
}

type WarmCacheOptions = {
  packageManager: PackageManager;
  packageSpec: string;
  env: BuildStepEnv;
  logger: bunyan;
};

/** Fills the cache that `resolvePackageExec(packageManager, [packageSpec, ...])` reads. */
async function warmPackageExecCacheAsync(options: WarmCacheOptions): Promise<void> {
  const { packageManager, packageSpec, env, logger } = options;
  switch (packageManager) {
    case PackageManager.NPM:
    case PackageManager.YARN:
      // Both run through `npx --yes`. `npx --package <spec> --call true` installs the
      // package into the npx cache without running its binary, and the later
      // `npx --yes <spec>` resolves from that cache.
      await spawn('npx', ['--yes', '--package', packageSpec, '--call', 'true'], { env, logger });
      return;
    case PackageManager.BUN:
    case PackageManager.PNPM:
      // `bun x` and `pnpm dlx` fetch through the manager's global package cache.
      await warmPackageAddCacheAsync(options);
      return;
  }
}

/** Installs the package into a throwaway directory, which fills the manager's package cache. */
async function warmPackageAddCacheAsync({
  packageManager,
  packageSpec,
  env,
  logger,
}: WarmCacheOptions): Promise<void> {
  const installDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-session-prefetch-'));
  try {
    await fs.promises.writeFile(
      path.join(installDir, 'package.json'),
      `${JSON.stringify({ name: 'eas-session-prefetch', private: true })}\n`
    );
    const add = resolvePackageAdd(packageManager, packageSpec);
    await spawn(add.command, add.args, { cwd: installDir, env, logger });
  } finally {
    await fs.promises.rm(installDir, { recursive: true, force: true });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
