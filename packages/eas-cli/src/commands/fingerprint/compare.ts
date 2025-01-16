import { Platform, Workflow } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { fetchBuildsAsync, formatBuild } from '../../commandUtils/builds';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppPlatform, BuildStatus, FingerprintFragment } from '../../graphql/generated';
import { FingerprintMutation } from '../../graphql/mutations/FingerprintMutation';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { FingerprintQuery } from '../../graphql/queries/FingerprintQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { maybeUploadFingerprintAsync } from '../../project/maybeUploadFingerprintAsync';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { resolveWorkflowPerPlatformAsync } from '../../project/workflow';
import { selectAsync } from '../../prompts';
import { Fingerprint, FingerprintDiffItem } from '../../utils/fingerprint';
import { createFingerprintAsync, diffFingerprint } from '../../utils/fingerprintCli';
import { abridgedDiff } from '../../utils/fingerprintDiff';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';
import { enableJsonOutput } from '../../utils/json';
import { Client } from '../../vcs/vcs';

export interface FingerprintCompareFlags {
  buildId?: string;
  hash1?: string;
  hash2?: string;
  nonInteractive: boolean;
  json: boolean;
}

export default class FingerprintCompare extends EasCommand {
  static override description = 'compare fingerprints of the current project, builds and updates';
  static override strict = false;

  static override args = [
    {
      name: 'hash1',
      description:
        "If provided alone, HASH1 is compared against the current project's fingerprint.",
      required: false,
    },
    {
      name: 'hash2',
      description: 'If two hashes are provided, HASH1 is compared against HASH2.',
      required: false,
    },
  ];

  static override flags = {
    'build-id': Flags.string({
      aliases: ['buildId'],
      description: 'Compare the fingerprint with the build with the specified ID',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(FingerprintCompare);
    const { hash1, hash2 } = args;
    const { json, 'non-interactive': nonInteractive, 'build-id': buildId } = flags;
    const sanitizedFlagsAndArgs = { json, nonInteractive, buildId, hash1, hash2 };

    const {
      projectId,
      privateProjectConfig: { projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(FingerprintCompare, {
      nonInteractive,
      withServerSideEnvironment: null,
    });
    if (json) {
      enableJsonOutput();
    }

    const firstFingerprintInfo = await getFirstFingerprintInfoAsync(
      graphqlClient,
      projectId,
      sanitizedFlagsAndArgs
    );
    const {
      fingerprint: firstFingerprint,
      platforms: platformsFromFirstFingerprint,
      origin: firstFingerprintOrigin,
    } = firstFingerprintInfo;

    const secondFingerprintInfo = await getSecondFingerprintInfoAsync(
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      platformsFromFirstFingerprint,
      sanitizedFlagsAndArgs
    );
    const { fingerprint: secondFingerprint, origin: secondFingerprintOrigin } =
      secondFingerprintInfo;

    if (firstFingerprint.hash === secondFingerprint.hash) {
      Log.log(
        `✅ ${capitalizeFirstLetter(
          firstFingerprintOrigin
        )} matches fingerprint from ${secondFingerprintOrigin}`
      );
      return;
    } else {
      Log.log(
        `🔄 ${capitalizeFirstLetter(
          firstFingerprintOrigin
        )} differs from ${secondFingerprintOrigin}`
      );
    }

    const fingerprintDiffs = diffFingerprint(projectDir, firstFingerprint, secondFingerprint);
    if (!fingerprintDiffs) {
      Log.error('Fingerprint diffs can only be computed for projects with SDK 52 or higher');
      return;
    }

    const filePathDiffs = fingerprintDiffs.filter(diff => {
      let sourceType;
      if (diff.op === 'added') {
        sourceType = diff.addedSource.type;
      } else if (diff.op === 'removed') {
        sourceType = diff.removedSource.type;
      } else if (diff.op === 'changed') {
        sourceType = diff.beforeSource.type;
      }
      return sourceType === 'dir' || sourceType === 'file';
    });
    if (filePathDiffs.length > 0) {
      Log.newLine();
      Log.log('📁 Paths with native dependencies:');
    }
    const fields = [];
    for (const diff of filePathDiffs) {
      const field = getDiffFilePathFields(diff);
      if (!field) {
        throw new Error(`Unsupported diff: ${JSON.stringify(diff)}`);
      }
      fields.push(field);
    }
    Log.log(
      formatFields(fields, {
        labelFormat: label => `    ${chalk.dim(label)}:`,
      })
    );

    const contentDiffs = fingerprintDiffs.filter(diff => {
      let sourceType;
      if (diff.op === 'added') {
        sourceType = diff.addedSource.type;
      } else if (diff.op === 'removed') {
        sourceType = diff.removedSource.type;
      } else if (diff.op === 'changed') {
        sourceType = diff.beforeSource.type;
      }
      return sourceType === 'contents';
    });

    for (const diff of contentDiffs) {
      printContentDiff(diff);
    }
  }
}

function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

async function getFirstFingerprintInfoAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  { buildId: buildIdFromArg, hash1, nonInteractive }: FingerprintCompareFlags
): Promise<{ fingerprint: Fingerprint; platforms: AppPlatform[]; origin: string }> {
  if (hash1) {
    const fingerprintFragment = await getFingerprintFragmentFromHashAsync(
      graphqlClient,
      projectId,
      hash1
    );
    const fingerprint = await getFingerprintAsync(fingerprintFragment);
    return {
      fingerprint,
      platforms: inferPlatformsFromSource(fingerprint),
      origin: `hash ${hash1}`,
    };
  }

  let buildId: string | null = buildIdFromArg ?? null;
  if (!buildId) {
    if (nonInteractive) {
      throw new Error('Build ID must be provided in non-interactive mode');
    }

    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    buildId = await selectBuildToCompareAsync(graphqlClient, projectId, displayName, {
      filters: { hasFingerprint: true },
    });
    if (!buildId) {
      throw new Error(); // exit, explanation already printed in prompt
    }
  }

  Log.log(`Comparing fingerprints of the current project and build ${buildId}…`);
  const buildWithFingerprint = await BuildQuery.withFingerprintByIdAsync(graphqlClient, buildId);
  if (!buildWithFingerprint.fingerprint) {
    throw new Error(`Fingerprint for build ${buildId} was not computed.`);
  } else if (!buildWithFingerprint.fingerprint.debugInfoUrl) {
    throw new Error(`Fingerprint source for build ${buildId} was not computed.`);
  }
  return {
    fingerprint: await getFingerprintAsync(buildWithFingerprint.fingerprint),
    platforms: [buildWithFingerprint.platform],
    origin: 'build',
  };
}

async function getSecondFingerprintInfoAsync(
  graphqlClient: ExpoGraphqlClient,
  projectDir: string,
  projectId: string,
  vcsClient: Client,
  firstFingerprintPlatforms: AppPlatform[],
  { hash2 }: FingerprintCompareFlags
): Promise<{ fingerprint: Fingerprint; origin: string }> {
  if (hash2) {
    const fingerprintFragment = await getFingerprintFragmentFromHashAsync(
      graphqlClient,
      projectId,
      hash2
    );
    if (!fingerprintFragment) {
      throw new Error(`Fingerprint with hash ${hash2} was not uploaded.`);
    }
    return { fingerprint: await getFingerprintAsync(fingerprintFragment), origin: `hash ${hash2}` };
  }

  const workflows = await resolveWorkflowPerPlatformAsync(projectDir, vcsClient);
  const optionsFromWorkflow = getFingerprintOptionsFromWorkflow(
    firstFingerprintPlatforms,
    workflows
  );

  const projectFingerprint = await createFingerprintAsync(projectDir, {
    ...optionsFromWorkflow,
    platforms: firstFingerprintPlatforms.map(appPlatformToString),
    debug: true,
    env: undefined,
  });
  if (!projectFingerprint) {
    throw new Error('Project fingerprints can only be computed for projects with SDK 52 or higher');
  }

  const uploadedFingerprint = await maybeUploadFingerprintAsync({
    hash: projectFingerprint.hash,
    fingerprint: {
      fingerprintSources: projectFingerprint.sources,
      isDebugFingerprintSource: Log.isDebug,
    },
    graphqlClient,
  });
  await FingerprintMutation.createFingerprintAsync(graphqlClient, projectId, {
    hash: uploadedFingerprint.hash,
    source: uploadedFingerprint.fingerprintSource,
  });

  return { fingerprint: projectFingerprint, origin: 'project' };
}

async function getFingerprintFragmentFromHashAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  hash: string
): Promise<FingerprintFragment> {
  const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
  const fingerprint = await FingerprintQuery.byHashAsync(graphqlClient, {
    appId: projectId,
    hash,
  });
  if (!fingerprint) {
    throw new Error(`Fingerprint with hash ${hash} was not uploaded for ${displayName}.`);
  }
  return fingerprint;
}

async function getFingerprintAsync(fingerprintFragment: FingerprintFragment): Promise<Fingerprint> {
  const fingerprintDebugUrl = fingerprintFragment.debugInfoUrl;
  if (!fingerprintDebugUrl) {
    throw new Error(
      `The source for fingerprint hash ${fingerprintFragment.hash} was not computed.`
    );
  }
  const fingerprintResponse = await fetch(fingerprintDebugUrl);
  return (await fingerprintResponse.json()) as Fingerprint;
}

function getFingerprintOptionsFromWorkflow(
  platforms: AppPlatform[],
  workflowsByPlatform: Record<Platform, Workflow>
): { workflow?: Workflow; ignorePaths?: string[] } {
  if (platforms.length === 0) {
    throw new Error('Could not determine platform from fingerprint sources');
  }

  // Single platform case
  if (platforms.length === 1) {
    const platform = platforms[0];
    return { workflow: workflowsByPlatform[appPlatformToPlatform(platform)] };
  }

  // Multiple platforms case
  const workflows = platforms.map(platform => workflowsByPlatform[appPlatformToPlatform(platform)]);

  // If all workflows are the same, return the common workflow
  const [firstWorkflow, ...restWorkflows] = workflows;
  if (restWorkflows.every(workflow => workflow === firstWorkflow)) {
    return { workflow: firstWorkflow };
  }

  // Generate ignorePaths for mixed workflows
  const ignorePaths = platforms
    .filter(platform => workflowsByPlatform[appPlatformToPlatform(platform)] === Workflow.MANAGED)
    .map(platform => `${appPlatformToString(platform)}/**/*`);

  return { ignorePaths };
}

function inferPlatformsFromSource(fingerprint: Fingerprint): AppPlatform[] {
  const sources = fingerprint.sources;
  const platforms = [];
  const containsAndroidReasons = sources.some(source => {
    return source.reasons.some(reason => /android/i.test(reason));
  });
  if (containsAndroidReasons) {
    platforms.push(AppPlatform.Android);
  }
  const containsIOSReasons = sources.some(source => {
    return source.reasons.some(reason => /ios/i.test(reason));
  });
  if (containsIOSReasons) {
    platforms.push(AppPlatform.Ios);
  }
  return platforms;
}

function printContentDiff(diff: FingerprintDiffItem): void {
  if (diff.op === 'added') {
    const sourceType = diff.addedSource.type;
    if (sourceType === 'contents') {
      printContentSource({
        op: diff.op,
        sourceType,
        contentsId: diff.addedSource.id,
        contentsAfter: diff.addedSource.contents,
      });
    }
  } else if (diff.op === 'removed') {
    const sourceType = diff.removedSource.type;
    if (sourceType === 'contents') {
      printContentSource({
        op: diff.op,
        sourceType,
        contentsId: diff.removedSource.id,
        contentsBefore: diff.removedSource.contents,
      });
    }
  } else if (diff.op === 'changed') {
    const sourceType = diff.beforeSource.type;
    if (sourceType === 'contents') {
      if (diff.afterSource.type !== 'contents') {
        throw new Error(
          `Changed fingerprint source types must be the same, received ${diff.beforeSource.type}, ${diff.afterSource.type}`
        );
      }
      printContentSource({
        op: diff.op,
        sourceType: diff.beforeSource.type, // before and after source types should be the same
        contentsId: diff.beforeSource.id, // before and after content ids should be the same
        contentsBefore: diff.beforeSource.contents,
        contentsAfter: diff.afterSource.contents,
      });
    }
  }
}

function getDiffFilePathFields(diff: FingerprintDiffItem): FormatFieldsItem | null {
  if (diff.op === 'added') {
    const sourceType = diff.addedSource.type;
    if (sourceType !== 'contents') {
      return getFilePathSourceFields({
        op: diff.op,
        sourceType,
        filePath: diff.addedSource.filePath,
      });
    }
  } else if (diff.op === 'removed') {
    const sourceType = diff.removedSource.type;
    if (sourceType !== 'contents') {
      return getFilePathSourceFields({
        op: diff.op,
        sourceType,
        filePath: diff.removedSource.filePath,
      });
    }
  } else if (diff.op === 'changed') {
    const sourceType = diff.beforeSource.type;
    if (sourceType !== 'contents') {
      return getFilePathSourceFields({
        op: diff.op,
        sourceType: diff.beforeSource.type, // before and after source types should be the same
        filePath: diff.beforeSource.filePath, // before and after filePaths should be the same
      });
    }
  }
  return null;
}

function getFilePathSourceFields({
  op,
  sourceType,
  filePath,
}: {
  op: 'added' | 'removed' | 'changed';
  sourceType: 'dir' | 'file';
  filePath: string;
}): FormatFieldsItem {
  if (sourceType === 'dir') {
    if (op === 'added') {
      return { label: 'new directory', value: filePath };
    } else if (op === 'removed') {
      return { label: 'removed directory', value: filePath };
    } else if (op === 'changed') {
      return { label: 'modified directory', value: filePath };
    }
  } else if (sourceType === 'file') {
    if (op === 'added') {
      return { label: 'new file', value: filePath };
    } else if (op === 'removed') {
      return { label: 'removed file', value: filePath };
    } else if (op === 'changed') {
      return { label: 'modified file', value: filePath };
    }
  }
  throw new Error(`Unsupported source and op: ${sourceType}, ${op}`);
}

const PRETTY_CONTENT_ID: Record<string, string> = {
  'expoAutolinkingConfig:ios': 'Expo autolinking config (iOS)',
  'expoAutolinkingConfig:android': 'Expo autolinking config (Android)',
  'packageJson:scripts': 'package.json scripts',
  expoConfig: 'Expo config',
};

function printContentSource({
  op,
  contentsBefore,
  contentsAfter,
  contentsId,
}: {
  op: 'added' | 'removed' | 'changed';
  sourceType: 'contents';
  contentsBefore?: string | Buffer;
  contentsAfter?: string | Buffer;
  contentsId: string;
}): void {
  Log.newLine();
  const prettyContentId = PRETTY_CONTENT_ID[contentsId] ?? contentsId;
  if (op === 'added') {
    Log.log(`${chalk.dim('📝 New content')}: ${prettyContentId}`);
  } else if (op === 'removed') {
    Log.log(`${chalk.dim('📝 Removed content')}: ${prettyContentId}`);
  } else if (op === 'changed') {
    Log.log(`${chalk.dim('📝 Modified content')}: ${prettyContentId}`);
  }
  printContentsDiff(contentsBefore ?? '', contentsAfter ?? '');
}

function printContentsDiff(contents1: string | Buffer, contents2: string | Buffer): void {
  const stringifiedContents1 = Buffer.isBuffer(contents1) ? contents1.toString() : contents1;
  const stringifiedContents2 = Buffer.isBuffer(contents2) ? contents2.toString() : contents2;

  const isStr1JSON = isJSON(stringifiedContents1);
  const isStr2JSON = isJSON(stringifiedContents2);

  const prettifiedContents1 = isStr1JSON
    ? JSON.stringify(JSON.parse(stringifiedContents1), null, 2)
    : stringifiedContents1;
  const prettifiedContents2 = isStr2JSON
    ? JSON.stringify(JSON.parse(stringifiedContents2), null, 2)
    : stringifiedContents2;

  abridgedDiff(prettifiedContents1, prettifiedContents2, 0);
}

function isJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

function appPlatformToPlatform(platform: AppPlatform): Platform {
  switch (platform) {
    case AppPlatform.Android:
      return Platform.ANDROID;
    case AppPlatform.Ios:
      return Platform.IOS;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function appPlatformToString(platform: AppPlatform): string {
  switch (platform) {
    case AppPlatform.Android:
      return 'android';
    case AppPlatform.Ios:
      return 'ios';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function selectBuildToCompareAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  projectDisplayName: string,
  {
    filters,
  }: {
    filters?: {
      statuses?: BuildStatus[];
      platform?: RequestedPlatform;
      profile?: string;
      hasFingerprint?: boolean;
    };
  } = {}
): Promise<string | null> {
  const spinner = ora().start('Fetching builds…');

  let builds;
  try {
    builds = await fetchBuildsAsync({ graphqlClient, projectId, filters });
    spinner.stop();
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the builds for the project ${projectDisplayName}.`
    );
    throw error;
  }
  if (builds.length === 0) {
    Log.warn(`No fingerprints have been computed for builds of project ${projectDisplayName}.`);
    return null;
  } else {
    const build = await selectAsync<string>(
      'Which build do you want to compare?',
      builds.map(build => ({
        title: formatBuild(build),
        value: build.id,
      }))
    );

    return build;
  }
}
