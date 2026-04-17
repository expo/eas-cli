import { UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { resolvePackageManager } from '../../utils/packageManager';
import { runExpoCliCommand } from '../../utils/project';

/** Matches `npx expo export -p` / `--platform` (see `npx expo export --help`). */
const EXPO_EXPORT_PLATFORMS = new Set(['android', 'ios', 'web', 'all']);

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
        id: 'no_minify',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'assetmap',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'no_ssg',
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
      const noMinify = inputs.no_minify.value as boolean | undefined;
      const assetmap = inputs.assetmap.value as boolean | undefined;
      const noSsg = inputs.no_ssg.value as boolean | undefined;
      const apiOnly = inputs.api_only.value as boolean | undefined;
      const platform = inputs.platform.value as string;


      const packageManager = resolvePackageManager(stepsCtx.workingDirectory);
      const exportCommand = getExportCommand({
        outputDir,
        dev,
        noMinify,
        assetmap,
        noSsg,
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
  noMinify,
  assetmap,
  noSsg,
  apiOnly,
  platform,
}: {
  outputDir: string;
  dev?: boolean;
  noMinify?: boolean;
  assetmap?: boolean;
  noSsg?: boolean;
  apiOnly?: boolean;
  platform: string;
}): string[] {
  const exportCommand = ['export', '--output-dir', outputDir, '--platform', platform];
  if (dev) {
    exportCommand.push('--dev');
  }
  if (noMinify) {
    exportCommand.push('--no-minify');
  }
  if (assetmap) {
    exportCommand.push('--dump-assetmap');
  }
  if (noSsg) {
    exportCommand.push('--no-ssg');
  }
  if (apiOnly) {
    exportCommand.push('--api-only');
  }
  return exportCommand;
}
