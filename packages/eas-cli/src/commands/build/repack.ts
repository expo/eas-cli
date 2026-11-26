import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import { CombinedError } from '@urql/core';
import chalk from 'chalk';
import { boolish } from 'getenv';

import {
  IosSigningBackend,
  REPACK_JOB_KEY,
  REPACK_WORKFLOW_FILE_NAME,
  createRepackWorkflowYamlConfig,
} from '../../build/repack';
import { listAndSelectBuildOnAppAsync } from '../../build/queries';
import { printBuildResults, printLogsUrls } from '../../build/utils/printBuildInfo';
import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { EasPaginatedQueryFlags } from '../../commandUtils/pagination';
import { buildProfileNamesFromProjectAsync } from '../../commandUtils/workflow/buildProfileUtils';
import { uploadWorkflowProjectSourceAsync } from '../../commandUtils/workflow/projectSource';
import { showWorkflowStatusAsync } from '../../commandUtils/workflow/utils';
import { BuildFragment, BuildStatus, WorkflowRunStatus } from '../../graphql/generated';
import { WorkflowRevisionMutation } from '../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log, { link } from '../../log';
import { requestedPlatformDisplayNames, selectPlatformAsync } from '../../platform';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { WorkflowFile } from '../../utils/workflowFile';

interface BuildRepackFlags {
  json: boolean;
  nonInteractive: boolean;
  offset?: number;
  limit?: number;
  platform?: Platform;
  profile?: string;
  sourceProfile?: string;
  maybeBuildId?: string;
  embedBundleAssets?: boolean;
  jsBundleOnly?: boolean;
  iosSigningBackend?: IosSigningBackend;
  message?: string;
  wait: boolean;
}

interface RawBuildRepackFlags {
  json: boolean;
  'non-interactive': boolean;
  offset: number | undefined;
  limit: number | undefined;
  platform: 'android' | 'ios' | undefined;
  profile: string | undefined;
  'source-profile': string | undefined;
  id: string | undefined;
  'embed-bundle-assets': boolean | undefined;
  'js-bundle-only': boolean | undefined;
  'ios-signing-backend': 'fastlane' | 'zsign' | undefined;
  message: string | undefined;
  wait: boolean;
}

export default class BuildRepack extends EasCommand {
  static override description =
    'repack an existing build with the JavaScript bundle and assets of the current project, without rebuilding native code';

  static override flags = {
    platform: Flags.option({
      char: 'p',
      options: ['android', 'ios'] as const,
    })(),
    id: Flags.string({
      description: 'ID of the build to repack.',
    }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json to repack with. Its credentials are used for signing, and the environment variables it sets are applied when the JavaScript bundle is built, so a large project can raise the Node.js heap limit with NODE_OPTIONS=--max-old-space-size=8192. Defaults to the profile of the source build.',
      helpValue: 'PROFILE_NAME',
    }),
    'source-profile': Flags.string({
      description:
        'Name of the source build profile from eas.json. Used to filter builds eligible for repacking.',
      helpValue: 'PROFILE_NAME',
    }),
    'embed-bundle-assets': Flags.boolean({
      allowNo: true,
      description:
        'Whether to embed the JavaScript bundle and assets in the repacked app. Defaults to what is detected from the source build.',
    }),
    'js-bundle-only': Flags.boolean({
      description:
        'Only replace the JavaScript bundle, keeping the rest of the app metadata from the source build.',
    }),
    'ios-signing-backend': Flags.option({
      options: ['fastlane', 'zsign'] as const,
      description:
        'iOS signing backend. "fastlane" (the default) requires a macOS worker. "zsign" (experimental) signs without Xcode and runs on a Linux worker.',
    })(),
    message: Flags.string({
      char: 'm',
      description: 'A short message describing the repacked build.',
    }),
    wait: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Wait for the repacked build to complete.',
    }),
    ...EasPaginatedQueryFlags,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(BuildRepack);
    if (rawFlags.json) {
      enableJsonOutput();
    }
    const flags = this.sanitizeFlags(rawFlags as RawBuildRepackFlags);

    const {
      loggedIn: { graphqlClient },
      getDynamicPrivateProjectConfigAsync,
      projectDir,
      vcsClient,
    } = await this.getContextAsync(BuildRepack, {
      nonInteractive: flags.nonInteractive,
      withServerSideEnvironment: null,
    });

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync({ skipPlugins: true });
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    const maybeBuild = flags.maybeBuildId
      ? await getRepackableBuildAsync(graphqlClient, {
          buildId: flags.maybeBuildId,
          projectId,
          platform: flags.platform,
        })
      : undefined;
    const platform =
      (maybeBuild?.platform.toLowerCase() as Platform | undefined) ??
      (await selectPlatformAsync(flags.platform));

    if (flags.iosSigningBackend && platform !== Platform.IOS) {
      throw new Error(`${chalk.bold('--ios-signing-backend')} can only be used with iOS builds.`);
    }

    if (flags.profile) {
      const buildProfileNames = await buildProfileNamesFromProjectAsync(projectDir);
      if (!buildProfileNames.has(flags.profile)) {
        throw new Error(`There is no build profile named "${flags.profile}" in eas.json.`);
      }
    }

    const build =
      maybeBuild ??
      (await selectBuildToRepackAsync(graphqlClient, {
        projectId,
        platform,
        nonInteractive: flags.nonInteractive,
        limit: flags.limit,
        offset: flags.offset,
        buildProfile: flags.sourceProfile,
      }));

    const yamlConfig = createRepackWorkflowYamlConfig({
      buildId: build.id,
      profile: flags.profile,
      embedBundleAssets: flags.embedBundleAssets,
      jsBundleOnly: flags.jsBundleOnly,
      iosSigningBackend: flags.iosSigningBackend,
      message: flags.message,
    });
    Log.debug(`Repack workflow:\n${yamlConfig}`);

    try {
      await WorkflowRevisionMutation.validateWorkflowYamlConfigAsync(graphqlClient, {
        appId: projectId,
        yamlConfig,
      });
    } catch (error) {
      if (error instanceof CombinedError) {
        WorkflowFile.maybePrintWorkflowFileValidationErrors({ error });
      }
      throw error;
    }

    let projectSource;
    try {
      projectSource = await uploadWorkflowProjectSourceAsync({
        graphqlClient,
        vcsClient,
        accountId: account.id,
        projectDir,
      });
    } catch (err) {
      Log.error('Failed to upload project sources.');
      throw err;
    }

    const { id: workflowRunId } = await WorkflowRunMutation.createWorkflowRunAsync(graphqlClient, {
      appId: projectId,
      workflowRevisionInput: {
        fileName: REPACK_WORKFLOW_FILE_NAME,
        yamlConfig,
      },
      workflowRunInput: { projectSource },
    });
    const workflowRunUrl = getWorkflowRunUrl(account.name, projectName, workflowRunId);

    Log.newLine();
    Log.log(
      `Repacking ${requestedPlatformDisplayNames[platform]} build ${chalk.bold(build.id)}${
        flags.profile ? ` with build profile "${flags.profile}"` : ''
      }.`
    );
    Log.log(`See logs: ${link(workflowRunUrl)}`);

    if (!flags.wait) {
      if (flags.json) {
        printJsonOnlyOutput({ id: workflowRunId, url: workflowRunUrl });
      }
      return;
    }

    const { status } = await showWorkflowStatusAsync(graphqlClient, {
      workflowRunId,
      spinnerUsesStdErr: boolish('CI', false) || flags.json,
    });

    const workflowRun = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, workflowRunId, {
      useCache: false,
    });
    const repackedBuild =
      workflowRun.jobs.find(job => job.key === REPACK_JOB_KEY)?.turtleBuild ?? null;

    if (status !== WorkflowRunStatus.Success) {
      if (repackedBuild) {
        printLogsUrls([repackedBuild]);
      }
      throw new Error(
        status === WorkflowRunStatus.Canceled
          ? 'Repacking the build was canceled.'
          : `Repacking the build failed. See logs: ${workflowRunUrl}`
      );
    }

    if (!repackedBuild) {
      throw new Error(
        `The repack workflow finished, but did not produce a build. See logs: ${workflowRunUrl}`
      );
    }

    if (flags.json) {
      printJsonOnlyOutput(repackedBuild);
    } else {
      printBuildResults([repackedBuild]);
    }
  }

  private sanitizeFlags(flags: RawBuildRepackFlags): BuildRepackFlags {
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (nonInteractive && !flags.id) {
      throw new Error(
        `${chalk.bold('--id')} is required when running with ${chalk.bold(
          '--non-interactive'
        )} flag.`
      );
    }
    return {
      json,
      nonInteractive,
      offset: flags.offset,
      limit: flags.limit,
      platform: flags.platform as Platform | undefined,
      profile: flags.profile,
      sourceProfile: flags['source-profile'],
      maybeBuildId: flags.id,
      embedBundleAssets: flags['embed-bundle-assets'],
      jsBundleOnly: flags['js-bundle-only'],
      iosSigningBackend: flags['ios-signing-backend'],
      message: flags.message,
      wait: flags.wait,
    };
  }
}

export async function getRepackableBuildAsync(
  graphqlClient: ExpoGraphqlClient,
  { buildId, projectId, platform }: { buildId: string; projectId: string; platform?: Platform }
): Promise<BuildFragment> {
  const build = await BuildQuery.byIdAsync(graphqlClient, buildId);
  if (build.app.id !== projectId) {
    throw new Error(`Build with ID ${buildId} does not belong to this project.`);
  }
  if (build.status !== BuildStatus.Finished) {
    throw new Error('Only builds that finished successfully can be repacked.');
  }
  if (!build.artifacts?.applicationArchiveUrl) {
    throw new Error(`Build with ID ${buildId} has no application archive to repack.`);
  }
  if (platform && build.platform !== toAppPlatform(platform)) {
    throw new Error(
      `Build with ID ${buildId} was not created for platform ${requestedPlatformDisplayNames[platform]}.`
    );
  }
  return build;
}

async function selectBuildToRepackAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    platform,
    nonInteractive,
    limit,
    offset,
    buildProfile,
  }: {
    projectId: string;
    platform: Platform;
    nonInteractive: boolean;
    limit?: number;
    offset?: number;
    buildProfile?: string;
  }
): Promise<BuildFragment> {
  const build = await listAndSelectBuildOnAppAsync(graphqlClient, {
    projectId,
    title: 'Which build would you like to repack?',
    paginatedQueryOptions: {
      limit,
      offset: offset ?? 0,
      nonInteractive,
      json: false,
    },
    filter: {
      platform: toAppPlatform(platform),
      status: BuildStatus.Finished,
      buildProfile,
    },
    selectPromptDisabledFunction: build => !build.artifacts?.applicationArchiveUrl,
    selectPromptWarningMessage: 'Only builds with an application archive can be repacked.',
  });
  if (!build) {
    throw new Error('There are no builds that can be repacked on this project.');
  }
  return build;
}
