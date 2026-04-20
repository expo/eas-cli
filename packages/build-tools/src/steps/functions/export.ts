import { UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { resolvePackageManager } from '../../utils/packageManager';
import { runExpoCliCommand } from '../../utils/project';

export function createEasExportBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'export',
    name: 'Export',
    __metricsId: 'eas/export',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'output_dir',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
        defaultValue: 'dist',
      }),
      BuildStepInput.createProvider({
        id: 'dev',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'minify',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'dump_assetmap',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'ssg',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'api_only',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'platform',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
        defaultValue: 'web',
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'export_dir',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs, env }) => {
      const outputDir = inputs.output_dir.value as string;
      const dev = inputs.dev.value as boolean | undefined;
      const minify = inputs.minify.value as boolean | undefined;
      const dumpAssetmap = inputs.dump_assetmap.value as boolean | undefined;
      const ssg = inputs.ssg.value as boolean | undefined;
      const apiOnly = inputs.api_only.value as boolean | undefined;
      const platform = inputs.platform.value as string;

      const packageManager = resolvePackageManager(stepsCtx.workingDirectory);
      const exportCommand = getExportCommand({
        outputDir,
        dev,
        minify,
        dumpAssetmap,
        ssg,
        apiOnly,
        platform,
      });
      stepsCtx.logger.info(`Running export command: expo ${exportCommand.join(' ')}`);

      try {
        await runExpoCliCommand({
          packageManager,
          args: exportCommand,
          options: {
            cwd: stepsCtx.workingDirectory,
            env,
            logger: stepsCtx.logger,
            stdio: 'pipe',
          },
        });
        outputs.export_dir.set(outputDir);
      } catch (error) {
        throw new UserError(
          'EXPO_EXPORT_FAILED',
          `Export command failed: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    },
  });
}

function getExportCommand({
  outputDir,
  dev,
  minify,
  dumpAssetmap,
  ssg,
  apiOnly,
  platform,
}: {
  outputDir: string;
  dev?: boolean;
  minify?: boolean;
  dumpAssetmap?: boolean;
  ssg?: boolean;
  apiOnly?: boolean;
  platform: string;
}): string[] {
  const exportCommand = ['export', '--output-dir', outputDir, '--platform', platform];
  if (dev) {
    exportCommand.push('--dev');
  }
  if (minify === false) {
    exportCommand.push('--no-minify');
  }
  if (dumpAssetmap) {
    exportCommand.push('--dump-assetmap');
  }
  if (ssg === false) {
    exportCommand.push('--no-ssg');
  }
  if (apiOnly) {
    exportCommand.push('--api-only');
  }
  return exportCommand;
}
