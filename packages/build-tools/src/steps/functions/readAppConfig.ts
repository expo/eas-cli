import { Metadata } from '@expo/eas-build-job';
import { BuildFunction, BuildStepOutput } from '@expo/steps';

import { readAppConfig } from '../../utils/appConfig';

export function createReadAppConfigBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'read_app_config',
    name: 'Read app config',
    __metricsId: 'eas/read_app_config',
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'app_name',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'app_slug',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'app_version',
        required: false,
      }),
    ],
    fn: async (stepCtx, { env, outputs }) => {
      const metadata = stepCtx.global.staticContext.metadata as Metadata | undefined;
      try {
        const appConfig = (
          await readAppConfig({
            projectDir: stepCtx.workingDirectory,
            env: Object.keys(env).reduce(
              (acc, key) => {
                acc[key] = env[key] ?? '';
                return acc;
              },
              {} as Record<string, string>
            ),
            logger: stepCtx.logger,
            sdkVersion: metadata?.sdkVersion,
          })
        ).exp;
        stepCtx.logger.info('Using app configuration:');
        stepCtx.logger.info(JSON.stringify(appConfig, null, 2));
        outputs.app_name.set(appConfig.name);
        outputs.app_slug.set(appConfig.slug);
        outputs.app_version.set(appConfig.version);
      } catch {
        // readAppConfig logs underlying failures.
      }
    },
  });
}
