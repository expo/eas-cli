import { Platform } from '@expo/config';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { PackageManager, resolvePackageManager } from '../../utils/packageManager';

import { installNodeModules } from './installNodeModules';

export function createPrebuildBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'prebuild',
    name: 'Prebuild',
    __metricsId: 'eas/prebuild',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'clean',
        defaultValue: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'apple_team_id',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'platform',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
    fn: async (stepCtx, { inputs, env }) => {
      const { logger } = stepCtx;
      const appleTeamId = inputs.apple_team_id.value as string | undefined;
      const packageManager = resolvePackageManager(stepCtx.workingDirectory);
      const defaultPlatform = process.platform === 'darwin' ? 'ios' : 'android';

      const job = stepCtx.global.staticContext.job;
      const prebuildCommandArgs = getPrebuildCommandArgs({
        platform: job.platform ?? defaultPlatform,
        customPrebuildCommand: job.platform ? job.experimental?.prebuildCommand : undefined,
        clean: inputs.clean.value as boolean,
      });
      const argsWithExpo = ['expo', ...prebuildCommandArgs];
      const options = {
        cwd: stepCtx.workingDirectory,
        logger,
        env: {
          EXPO_IMAGE_UTILS_NO_SHARP: '1',
          ...env,
          ...(appleTeamId ? { APPLE_TEAM_ID: appleTeamId } : {}),
        },
      };
      if (packageManager === PackageManager.NPM) {
        await spawn('npx', argsWithExpo, options);
      } else if (packageManager === PackageManager.YARN) {
        await spawn('yarn', argsWithExpo, options);
      } else if (packageManager === PackageManager.PNPM) {
        await spawn('pnpm', argsWithExpo, options);
      } else if (packageManager === PackageManager.BUN) {
        await spawn('bun', argsWithExpo, options);
      } else {
        throw new Error(`Unsupported package manager: ${packageManager}`);
      }
      await installNodeModules(stepCtx, env);
    },
  });
}

function getPrebuildCommandArgs({
  platform,
  customPrebuildCommand,
  clean,
}: {
  platform: Platform;
  customPrebuildCommand?: string;
  clean: boolean;
}): string[] {
  if (customPrebuildCommand) {
    return sanitizeUserDefinedPrebuildCommand({
      customPrebuildCommand,
      platform,
      clean,
    });
  }
  return ['prebuild', '--no-install', '--platform', platform, ...(clean ? ['--clean'] : [])];
}

// TODO: deprecate prebuildCommand in eas.json
function sanitizeUserDefinedPrebuildCommand({
  customPrebuildCommand,
  platform,
  clean,
}: {
  customPrebuildCommand: string;
  platform: Platform;
  clean: boolean;
}): string[] {
  let prebuildCommand = customPrebuildCommand;
  if (!prebuildCommand.match(/(?:--platform| -p)/)) {
    prebuildCommand = `${prebuildCommand} --platform ${platform}`;
  }
  if (clean) {
    prebuildCommand = `${prebuildCommand} --clean`;
  }
  const npxCommandPrefix = 'npx ';
  const expoCommandPrefix = 'expo ';
  const expoCliCommandPrefix = 'expo-cli ';
  if (prebuildCommand.startsWith(npxCommandPrefix)) {
    prebuildCommand = prebuildCommand.substring(npxCommandPrefix.length).trim();
  }
  if (prebuildCommand.startsWith(expoCommandPrefix)) {
    prebuildCommand = prebuildCommand.substring(expoCommandPrefix.length).trim();
  }
  if (prebuildCommand.startsWith(expoCliCommandPrefix)) {
    prebuildCommand = prebuildCommand.substring(expoCliCommandPrefix.length).trim();
  }
  return prebuildCommand.split(' ');
}
