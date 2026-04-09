import { UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
  spawnAsync,
} from '@expo/steps';

import { runEasCliCommand } from '../../utils/easCli';

export function createEasDeployBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'deploy',
    name: 'Deploy',
    __metricsId: 'eas/deploy',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'alias',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'prod',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'source_maps',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'export_command',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
        defaultValue: 'npx expo export --platform web',
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'deploy_json',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs, env }) => {
      const alias = inputs.alias.value as string | undefined;
      const prod = inputs.prod.value as boolean | undefined;
      const sourceMaps = inputs.source_maps.value as boolean | undefined;
      const exportCommand = inputs.export_command.value as string;

      stepsCtx.logger.info(`Running export command: ${exportCommand}`);
      try {
        await spawnAsync('sh', ['-c', exportCommand], {
          cwd: stepsCtx.workingDirectory,
          env,
          logger: stepsCtx.logger,
          stdio: 'pipe',
        });
      } catch (error) {
        throw new UserError(
          'EAS_DEPLOY_EXPORT_FAILED',
          `Export command failed: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }

      const deployCommand = getDeployCommand({
        alias,
        prod,
        environment: stepsCtx.global.staticContext.metadata?.environment,
        sourceMaps,
      });
      stepsCtx.logger.info(`Running deploy command: eas ${deployCommand.join(' ')}`);

      try {
        const result = await runEasCliCommand({
          args: deployCommand,
          options: {
            cwd: stepsCtx.workingDirectory,
            env,
            logger: stepsCtx.logger,
          },
        });
        outputs.deploy_json.set(result.stdout.toString());
      } catch (error) {
        throw new UserError(
          'EAS_DEPLOY_FAILED',
          `Deploy command failed: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    },
  });
}

function getDeployCommand({
  alias,
  prod,
  environment,
  sourceMaps,
}: {
  alias?: string;
  prod?: boolean;
  environment?: string;
  sourceMaps?: boolean;
}): string[] {
  const deployCommand = ['deploy', '--non-interactive', '--json'];

  if (environment) {
    deployCommand.push('--environment', environment);
  }

  if (alias) {
    deployCommand.push('--alias', alias);
  }

  if (prod) {
    deployCommand.push('--prod');
  }

  if (sourceMaps === true) {
    deployCommand.push('--source-maps');
  } else if (sourceMaps === false) {
    deployCommand.push('--no-source-maps');
  }

  return deployCommand;
}
