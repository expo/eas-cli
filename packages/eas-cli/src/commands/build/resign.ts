import { Platform } from '@expo/eas-build-job';
import { CredentialsSource, EasJson, EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import { handleDeprecatedEasJsonAsync } from '.';
import { waitForBuildEndAsync } from '../../build/build';
import { ensureIosCredentialsForBuildResignAsync } from '../../build/ios/credentials';
import { prepareCredentialsToResign } from '../../build/ios/prepareJob';
import { listAndSelectBuildOnAppAsync } from '../../build/queries';
import { printBuildResults, printLogsUrls } from '../../build/utils/printBuildInfo';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { EasPaginatedQueryFlags } from '../../commandUtils/pagination';
import { CredentialsContext } from '../../credentials/context';
import {
  BuildFragment,
  BuildStatus,
  DistributionType,
  StatuspageServiceName,
} from '../../graphql/generated';
import { BuildMutation } from '../../graphql/mutations/BuildMutation';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import { requestedPlatformDisplayNames, selectPlatformAsync } from '../../platform';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { resolveTargetsAsync } from '../../project/ios/target';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { printJsonOnlyOutput } from '../../utils/json';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';

interface BuildResignFlags {
  json: boolean;
  nonInteractive: boolean;
  offset?: number;
  limit?: number;
  platform?: Platform;
  profile?: string;
  maybeBuildId?: string;
  wait: boolean;
}
interface RawBuildResignFlags {
  json: boolean;
  'non-interactive': boolean;
  offset: number | undefined;
  limit: number | undefined;
  platform: 'android' | 'ios' | undefined;
  profile: string | undefined;
  wait: boolean;
  'build-id': string | undefined;
}

export default class BuildResign extends EasCommand {
  static override description = 'resign a build archive';

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
    wait: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Wait for build(s) to complete',
    }),
    'build-id': Flags.string({
      description: 'Id of the build to resign',
    }),
    ...EasPaginatedQueryFlags,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Analytics,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(BuildResign);
    const flags = this.sanitizeFlags(rawFlags as RawBuildResignFlags);
    const { limit, offset, nonInteractive } = flags;

    const {
      loggedIn: { actor, graphqlClient },
      getDynamicProjectConfigAsync,
      projectDir,
      analytics,
    } = await this.getContextAsync(BuildResign, {
      nonInteractive: flags.nonInteractive,
    });

    const maybeBuild = flags.maybeBuildId
      ? await this.maybeGetBuildAsync(graphqlClient, flags.maybeBuildId)
      : undefined;
    const platform =
      (maybeBuild?.platform.toLowerCase() as Platform | undefined) ??
      (await selectPlatformAsync(flags.platform));
    if (platform === Platform.ANDROID) {
      throw new Error('Re-signing archives is not supported on Android yet.');
    }

    await handleDeprecatedEasJsonAsync(projectDir, flags.nonInteractive);

    await maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasBuild]);
    const easJsonAccessor = new EasJsonAccessor(projectDir);
    const easJsonCliConfig: EasJson['cli'] =
      (await EasJsonUtils.getCliConfigAsync(easJsonAccessor)) ?? {};

    const buildProfile = await EasJsonUtils.getBuildProfileAsync(
      easJsonAccessor,
      platform,
      flags.profile ?? 'production'
    );
    const { exp, projectId } = await getDynamicProjectConfigAsync({ env: buildProfile.env });
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    const build = await this.ensureBuildSelectedAsync(
      { graphqlClient, projectId, platform, nonInteractive, limit, offset },
      maybeBuild
    );
    const credentialsCtx = new CredentialsContext({
      projectInfo: { exp, projectId },
      nonInteractive,
      projectDir,
      user: actor,
      graphqlClient,
      analytics,
      env: buildProfile.env,
      easJsonCliConfig,
    });
    if (buildProfile.credentialsSource !== CredentialsSource.LOCAL) {
      await credentialsCtx.appStore.ensureAuthenticatedAsync();
    }
    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      {
        projectDir,
        nonInteractive,
        exp,
      },
      buildProfile
    );
    const targets = await resolveTargetsAsync({
      projectDir,
      exp,
      xcodeBuildContext,
      env: buildProfile.env,
    });
    const credentialsResult = await ensureIosCredentialsForBuildResignAsync(
      credentialsCtx,
      targets,
      buildProfile
    );
    const job = {
      buildId: build.id,
      jobOverrides: {
        secrets: prepareCredentialsToResign(credentialsResult.credentials),
        builderEnvironment: { image: 'default' },
      },
    };
    const newBuild = await BuildMutation.retryIosBuildAsync(graphqlClient, job);

    Log.addNewLineIfNone();
    printLogsUrls([newBuild]);
    Log.newLine();
    if (!flags.wait) {
      if (flags.json) {
        printJsonOnlyOutput(newBuild);
      }
      return;
    }

    const buildResult = await waitForBuildEndAsync(graphqlClient, {
      buildIds: [newBuild.id],
      accountName: account.name,
    });
    if (!flags.json) {
      printBuildResults(buildResult);
    } else {
      assert(buildResult[0], 'missing build results');
      printJsonOnlyOutput(buildResult[0]);
    }
  }
  sanitizeFlags(flags: RawBuildResignFlags): BuildResignFlags {
    const nonInteractive = flags['non-interactive'];
    const maybeBuildId = flags['build-id'];
    if (nonInteractive && !maybeBuildId) {
      throw new Error(
        `${chalk.bold('--build-id')} is required when running with ${chalk.bold(
          '--non-interactive'
        )} flag.`
      );
    }
    return {
      json: flags.json,
      nonInteractive,
      offset: flags.offset,
      limit: flags.limit,
      platform: flags.platform as Platform | undefined,
      profile: flags.profile,
      maybeBuildId,
      wait: flags.wait,
    };
  }

  async ensureBuildSelectedAsync(
    {
      graphqlClient,
      projectId,
      platform,
      nonInteractive,
      limit,
      offset,
    }: {
      graphqlClient: ExpoGraphqlClient;
      projectId: string;
      platform: Platform;
      nonInteractive: boolean;
      limit?: number;
      offset?: number;
    },
    maybeBuild?: BuildFragment
  ): Promise<BuildFragment> {
    if (maybeBuild) {
      return maybeBuild;
    }
    const build = await listAndSelectBuildOnAppAsync(graphqlClient, {
      projectId,
      title: 'Which build would you like to sign with a new credentials?',
      paginatedQueryOptions: {
        limit,
        offset: offset ?? 0,
        nonInteractive,
        json: false,
      },
      filter: {
        distribution: DistributionType.Internal,
        platform: toAppPlatform(platform),
        //status: BuildStatus.Finished,
      },
    });
    if (!build) {
      throw new Error('There are no builds that can be resigned on this project.');
    }
    return build;
  }

  async maybeGetBuildAsync(
    graphqlClient: ExpoGraphqlClient,
    maybeBuildId?: string,
    maybePlatform?: Platform
  ): Promise<BuildFragment | undefined> {
    if (maybeBuildId) {
      const build = await BuildQuery.byIdAsync(graphqlClient, maybeBuildId);
      if (build.distribution !== DistributionType.Internal) {
        throw new Error('This is not internal distribution build.');
      }
      if (build.status !== BuildStatus.Finished) {
        throw new Error('You can only resign builds that finished successfully.');
      }
      if (maybePlatform && build.platform !== toAppPlatform(maybePlatform)) {
        throw new Error(
          `Build with id ${maybeBuildId} was not created for platform ${requestedPlatformDisplayNames[maybePlatform]}.`
        );
      }
      return build;
    }
    return undefined;
  }
}
