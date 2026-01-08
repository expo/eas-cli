import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { asyncResult } from '@expo/results';

import { sleepAsync } from '../../utils/retry';

// Needs to conform to https://github.com/google/android-cuttlefish/blob/928026d2833b3e326d9d3b4a9a477e522b37b825/base/cvd/cuttlefish/host/commands/cvd/cli/parser/load_config.proto#L29-L36.
// See example: https://github.com/google/android-cuttlefish/blob/928026d2833b3e326d9d3b4a9a477e522b37b825/base/cvd/cuttlefish/host/cvd_test_configs/main_phone.json
const CVD_CONFIG_JSON = {
  common: {
    host_package: '@ab/aosp-android-latest-release/aosp_cf_x86_64_only_phone-userdebug',
  },
  instances: [
    {
      '@import': 'phone',
      graphics: {
        displays: [
          // Pixel 5
          {
            dpi: 432,
            height: 2340,
            width: 1080,
          },
        ],
      },
      vm: {
        memory_mb: 4096,
      },
      disk: {
        default_build: '@ab/aosp-main/aosp_cf_x86_64_phone-trunk_staging-userdebug',
      },
    },
  ],
};

export function createStartCuttlefishDeviceBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_cuttlefish_device',
    name: 'Start Cuttlefish Device',
    __metricsId: 'eas/start_cuttlefish_device',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'count',
        required: false,
        defaultValue: 1,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
    ],
    fn: async ({ logger }, { env, inputs }) => {
      const count = Number(inputs.count ?? 1);

      const dependencyCheck = await asyncResult(
        Promise.all([spawn('docker', ['--version'], { env }), spawn('cvdr', ['--help'], { env })])
      );
      if (!dependencyCheck.ok) {
        logger.error(
          dependencyCheck.reason,
          'Cuttlefish requires Docker and cvdr, which are only available on the latest Android worker image. Add `image: latest` to your job configuration to use the latest image.'
        );
        throw new Error(
          'Cuttlefish device start is only supported on the latest Android worker image.'
        );
      }

      logger.info('Starting adb server');
      await spawn('adb', ['start-server'], { env, logger });

      logger.info('Starting Cuttlefish Orchestrator container');

      await spawn(
        'docker',
        [
          'run',
          '--detach',
          '--name',
          'cuttlefish-orchestrator',
          '--publish',
          '8080:8080',
          '--env',
          'CONFIG_FILE=/conf.toml',
          '--volume',
          '/etc/cuttlefish/conf.toml:/conf.toml',
          '--volume',
          '/var/run/docker.sock:/var/run/docker.sock',
          '--tty',
          'us-docker.pkg.dev/android-cuttlefish-artifacts/cuttlefish-orchestration/cuttlefish-cloud-orchestrator:unstable',
        ],
        { env, logger }
      );

      // Wait a minute tops for cvdr to be ready
      const readyDeadline = Date.now() + 60_000;
      let cvdrReady = false;
      while (Date.now() < readyDeadline) {
        const result = await asyncResult(spawn('cvdr', ['list'], { env }));
        if (result.ok) {
          cvdrReady = true;
          logger.info('Cuttlefish Orchestrator is ready!');
          break;
        }
        // Chekc every second
        await sleepAsync(1_000);
      }

      if (!cvdrReady) {
        throw new Error('Timed out waiting for Cuttlefish Orchestrator to be ready.');
      }

      logger.info('Creating CVD');

      const args = [];

      const cvdConfigJson = env.CVD_CONFIG_JSON ?? JSON.stringify(CVD_CONFIG_JSON);
      if (cvdConfigJson) {
        const configJsonDirectory = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'start_cuttlefish-')
        );
        const configJsonPath = path.join(configJsonDirectory, 'config.json');
        await fs.promises.writeFile(configJsonPath, cvdConfigJson);
        args.push(configJsonPath);
      }

      if (count > 1) {
        args.push('--num_instances', String(count));
      }

      await spawn('cvdr', ['create', ...args], { env, logger });

      logger.info('Listing adb devices...');
      await spawn('adb', ['devices'], { env, logger });
      await spawn('adb', ['shell', 'input', 'keyevent', '82'], { env, logger });
    },
  });
}
