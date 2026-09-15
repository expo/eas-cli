import { DeviceRunSession } from '@expo/eas-build-job';
import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { createAgentDevicePackageSpec } from '../../steps/functions/startAgentDeviceRemoteSession';
import {
  installAppiumAsync,
  resolveAppium3VersionSpec,
  resolveAppiumDriverName,
} from '../../steps/functions/startAppiumRemoteSession';
import { ARGENT_PACKAGE_NAME } from '../../steps/functions/startArgentRemoteSession';
import { type SessionRuntime, type SessionTask, type SessionTaskContext } from '../runtime';

export const PREFETCH_TOOLING_TASK_ID = 'prefetch_tooling';

const SERVE_SIM_PACKAGE_NAME = '@expo/serve-sim';
const EXPO_DEVICE_HUB_PACKAGE_NAME = 'expo-device-hub';

/**
 * Resolves and caches the controller and preview packages while the device
 * boots, so the tasks that start them find the packages installed. Every part is
 * best effort: a failure here only means the start task fetches the package
 * itself, as it does today.
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
      // `npx --package <spec> --call true` installs the package into the npx
      // cache without running its binary. The later `npx --yes <spec>` start
      // then resolves from that cache.
      await spawn('npx', ['--yes', '--package', previewPackageSpec, '--call', 'true'], {
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
          // The same global install the controller start performs; it is a no-op the second time.
          await spawn('bun', ['add', '--global', spec], { env: runtime.env, logger });
        },
      });
      break;
    }
    case DeviceRunSession.Controller.ARGENT: {
      const spec = `${ARGENT_PACKAGE_NAME}@${packageVersion ?? 'latest'}`;
      prefetches.push({
        description: spec,
        run: async ({ runtime, logger }) => {
          // Populates Bun's package cache, which `bun x <spec>` reads at controller start.
          await spawn('bun', ['add', '--global', spec], { env: runtime.env, logger });
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
