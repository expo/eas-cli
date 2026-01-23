import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { asyncResult } from '@expo/results';

import { sleepAsync } from '../../utils/retry';

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
      await spawn('cvdr', ['create', ...(count > 1 ? ['--num_instances', String(count)] : [])], {
        env,
        logger,
      });

      logger.info('Listing adb devices...');
      await spawn('adb', ['devices'], { env, logger });
      await spawn('adb', ['shell', 'input', 'keyevent', '82'], { env, logger });
    },
  });
}
