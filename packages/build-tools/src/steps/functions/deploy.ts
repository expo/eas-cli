import { UserError } from '@expo/eas-build-job';
import { PipeMode, bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
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
      // Match eas/export default `output_dir`
      BuildStepInput.createProvider({
        id: 'export_dir',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
        defaultValue: 'dist',
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'deploy_json',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'deploy_url',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'deploy_deployment_url',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'deploy_identifier',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'deploy_dashboard_url',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'deploy_alias_url',
        required: false,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs, env }) => {
      const alias = inputs.alias.value as string | undefined;
      const prod = inputs.prod.value as boolean | undefined;
      const sourceMaps = inputs.source_maps.value as boolean | undefined;
      const exportDir = inputs.export_dir.value as string;

      const deployCommand = getDeployCommand({
        exportDir,
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
            mode: PipeMode.STDERR_ONLY_AS_STDOUT,
          },
        });

        const deployJson = result.stdout.toString();
        outputs.deploy_json.set(deployJson);
        const parsedDeploymentOutput = parseDeploymentOutput({
          deployJson,
          logger: stepsCtx.logger,
        });
        if (parsedDeploymentOutput) {
          for (const [key, value] of Object.entries(parsedDeploymentOutput)) {
            outputs[key].set(value);
          }
        }
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
  exportDir,
  alias,
  prod,
  environment,
  sourceMaps,
}: {
  exportDir: string;
  alias?: string;
  prod?: boolean;
  environment?: string;
  sourceMaps?: boolean;
}): string[] {
  const deployCommand = ['deploy', '--non-interactive', '--json', '--export-dir', exportDir];
  if (environment) {
    deployCommand.push('--environment', environment);
  }
  if (alias) {
    deployCommand.push('--alias', alias);
  }
  if (prod) {
    deployCommand.push('--prod');
  }
  if (sourceMaps) {
    deployCommand.push('--source-maps');
  }
  return deployCommand;
}

function parseDeploymentOutput({ deployJson, logger }: { deployJson: string; logger: bunyan }): {
  deploy_url: string;
  deploy_deployment_url: string;
  deploy_identifier: string;
  deploy_dashboard_url: string;
  deploy_alias_url: string;
} | null {
  try {
    // TODO: improve typing here; Look into WorkerDeploymentData
    const deployObject = JSON.parse(deployJson);
    return {
      deploy_url: deployObject.production.url || deployObject.aliases[0].url || deployObject.url,
      deploy_deployment_url: deployObject.url,
      deploy_identifier: deployObject.identifier,
      deploy_dashboard_url: deployObject.dashboardUrl,
      deploy_alias_url: deployObject.aliases[0].url,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      'Failed to parse deploy JSON: ' +
        `${message}\n` +
        'DEPLOY_URL, DEPLOY_DEPLOYMENT_URL, DEPLOY_IDENTIFIER, DEPLOY_DASHBOARD_URL, DEPLOY_ALIAS_URL will be unavailable on this build.',
      { error }
    );
    return null;
  }
}
