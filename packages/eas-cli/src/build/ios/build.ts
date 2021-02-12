import { IOSConfig } from '@expo/config-plugins';
import { Workflow } from '@expo/eas-build-job';
import { EasConfig } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import sortBy from 'lodash/sortBy';
import path from 'path';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import { prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContext } from '../context';
import { Platform } from '../types';
import { ensureBundleIdentifierIsValidAsync } from './bundleIdentifer';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { ensureIosCredentialsAsync } from './credentials';
import { prepareJobAsync } from './prepareJob';

export async function prepareIosBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig
): Promise<() => Promise<string>> {
  const buildCtx = createBuildContext<Platform.iOS>({
    commandCtx,
    platform: Platform.iOS,
    easConfig,
  });

  if (
    buildCtx.buildProfile.workflow === Workflow.Generic &&
    !(await fs.pathExists(path.join(commandCtx.projectDir, 'ios')))
  ) {
    throw new Error(
      `"ios" directory not found. If you're trying to build a managed project, set ${chalk.bold(
        `builds.ios.${commandCtx.profile}.workflow`
      )} in "eas.json" to "managed".`
    );
  }

  let iosNativeProjectScheme: string | undefined;
  let iosApplicationNativeTarget: string | undefined;
  if (buildCtx.buildProfile.workflow === Workflow.Generic) {
    iosNativeProjectScheme = buildCtx.buildProfile.scheme ?? (await resolveSchemeAsync(buildCtx));
    iosApplicationNativeTarget = await IOSConfig.BuildScheme.getApplicationTargetForSchemeAsync(
      buildCtx.commandCtx.projectDir,
      iosNativeProjectScheme
    );
  }

  await ensureBundleIdentifierIsValidAsync(commandCtx.projectDir);

  return await prepareBuildRequestForPlatformAsync({
    ctx: buildCtx,
    projectConfiguration: {
      iosNativeProjectScheme,
      iosApplicationNativeTarget,
    },
    ensureCredentialsAsync: ensureIosCredentialsAsync,
    ensureProjectConfiguredAsync: async () => {
      await validateAndSyncProjectConfigurationAsync({
        projectDir: commandCtx.projectDir,
        exp: commandCtx.exp,
        buildProfile: buildCtx.buildProfile,
      });
    },
    prepareJobAsync,
  });
}

async function resolveSchemeAsync(ctx: BuildContext<Platform.iOS>): Promise<string> {
  const schemes = IOSConfig.BuildScheme.getBuildSchemesFromXcodeproj(ctx.commandCtx.projectDir);
  if (schemes.length === 1) {
    return schemes[0];
  }

  const sortedSchemes = sortBy(schemes);
  Log.newLine();
  Log.log(
    `We've found multiple schemes in your Xcode project: ${chalk.bold(sortedSchemes.join(', '))}`
  );
  Log.log(
    `You can specify the scheme you want to build at ${chalk.bold(
      `builds.ios.${ctx.commandCtx.profile}.scheme`
    )} in eas.json.`
  );
  if (ctx.commandCtx.nonInteractive) {
    const withoutTvOS = sortedSchemes.filter(i => !i.includes('tvOS'));
    const scheme = withoutTvOS.length > 0 ? withoutTvOS[0] : sortedSchemes[0];
    Log.log(
      `You've run Expo CLI in non-interactive mode, choosing the ${chalk.bold(scheme)} scheme.`
    );
    Log.newLine();
    return scheme;
  } else {
    const { selectedScheme } = await promptAsync({
      type: 'select',
      name: 'selectedScheme',
      message: 'Which scheme would you like to build now?',
      choices: sortedSchemes.map(scheme => ({ title: scheme, value: scheme })),
    });
    Log.newLine();
    return selectedScheme as string;
  }
}
