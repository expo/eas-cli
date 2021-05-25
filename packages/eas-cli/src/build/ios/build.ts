import { IOSConfig } from '@expo/config-plugins';
import { Ios, Job, Metadata, Workflow } from '@expo/eas-build-job';
import { EasConfig } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import sortBy from 'lodash/sortBy';
import path from 'path';

import { IosCredentials } from '../../credentials/ios/types';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import Log from '../../log';
import { ensureBundleIdentifierIsDefinedForManagedProjectAsync } from '../../project/ios/bundleIdentifier';
import { XcodeBuildContext, resolveTargetsAsync } from '../../project/ios/target';
import { promptAsync } from '../../prompts';
import { JobData, prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContext } from '../context';
import { transformMetadata } from '../graphql';
import { Platform } from '../types';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { ensureIosCredentialsAsync } from './credentials';
import { transformGenericJob, transformManagedJob } from './graphql';
import { prepareJobAsync } from './prepareJob';

export async function prepareIosBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig
): Promise<() => Promise<string | undefined>> {
  const buildCtx = createBuildContext<Platform.IOS>({
    commandCtx,
    platform: Platform.IOS,
    easConfig,
  });

  if (
    buildCtx.buildProfile.workflow === Workflow.GENERIC &&
    !(await fs.pathExists(path.join(commandCtx.projectDir, 'ios')))
  ) {
    throw new Error(
      `"ios" directory not found. If you're trying to build a managed project, set ${chalk.bold(
        `builds.ios.${commandCtx.profile}.workflow`
      )} in "eas.json" to "managed".`
    );
  }

  if (buildCtx.buildProfile.workflow === Workflow.MANAGED) {
    await ensureBundleIdentifierIsDefinedForManagedProjectAsync(
      commandCtx.projectDir,
      commandCtx.exp
    );
  }

  const xcodeBuildContext = await resolveXcodeBuildContextAsync(buildCtx);
  const targets = await resolveTargetsAsync(
    {
      projectDir: commandCtx.projectDir,
      exp: commandCtx.exp,
    },
    xcodeBuildContext
  );

  return await prepareBuildRequestForPlatformAsync({
    ctx: buildCtx,
    ensureCredentialsAsync: async (ctx: BuildContext<Platform.IOS>) => {
      return ensureIosCredentialsAsync(ctx, targets);
    },
    ensureProjectConfiguredAsync: async () => {
      await validateAndSyncProjectConfigurationAsync({
        projectDir: commandCtx.projectDir,
        exp: commandCtx.exp,
        buildProfile: buildCtx.buildProfile,
      });
    },
    prepareJobAsync: async (
      ctx: BuildContext<Platform.IOS>,
      jobData: JobData<IosCredentials>
    ): Promise<Job> => {
      return await prepareJobAsync(ctx, { ...jobData, buildScheme: xcodeBuildContext.buildScheme });
    },
    sendBuildRequestAsync: async (
      appId: string,
      job: Ios.Job,
      metadata: Metadata
    ): Promise<BuildResult> => {
      const graphqlMetadata = transformMetadata(metadata);
      if (job.type === Workflow.GENERIC) {
        const graphqlJob = transformGenericJob(job);
        return await BuildMutation.createIosGenericBuildAsync({
          appId,
          job: graphqlJob,
          metadata: graphqlMetadata,
        });
      } else {
        const graphqlJob = transformManagedJob(job);
        return await BuildMutation.createIosManagedBuildAsync({
          appId,
          job: graphqlJob,
          metadata: graphqlMetadata,
        });
      }
    },
  });
}

async function resolveXcodeBuildContextAsync(
  buildCtx: BuildContext<Platform.IOS>
): Promise<XcodeBuildContext> {
  if (buildCtx.buildProfile.workflow === Workflow.GENERIC) {
    const buildScheme = buildCtx.buildProfile.scheme ?? (await resolveSchemeAsync(buildCtx));
    return {
      buildScheme,
      buildConfiguration:
        buildCtx.buildProfile.schemeBuildConfiguration ??
        (await IOSConfig.BuildScheme.getArchiveBuildConfigurationForSchemeAsync(
          buildCtx.commandCtx.projectDir,
          buildScheme
        )),
      applicationTarget: await IOSConfig.BuildScheme.getApplicationTargetNameForSchemeAsync(
        buildCtx.commandCtx.projectDir,
        buildScheme
      ),
    };
  } else {
    const expoName = buildCtx.commandCtx.exp.name;
    if (!expoName) {
      throw new Error('"expo.name" is required in your app.json');
    }
    const sanitizedExpoName = sanitizedName(expoName);
    if (!sanitizedExpoName) {
      throw new Error('"expo.name" needs to contain some alphanumeric characters');
    }
    return {
      buildScheme: sanitizedExpoName,
    };
  }
}

// copy-pasted from expo-cli
// https://github.com/expo/expo-cli/blob/master/packages/expo-cli/src/utils/extractTemplateAppAsync.ts#L15
function sanitizedName(name: string) {
  return name
    .replace(/[\W_]+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function resolveSchemeAsync(ctx: BuildContext<Platform.IOS>): Promise<string> {
  const schemes = IOSConfig.BuildScheme.getSchemesFromXcodeproj(ctx.commandCtx.projectDir);
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
