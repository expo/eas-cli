import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { fetchBuildsAsync, formatBuild } from '../../commandUtils/builds';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppPlatform, BuildStatus } from '../../graphql/generated';
import { FingerprintMutation } from '../../graphql/mutations/FingerprintMutation';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
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

export default class FingerprintCompare extends EasCommand {
  static override description = 'compare fingerprints of the current project, builds and updates';
  static override hidden = true;

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
    const { flags } = await this.parse(FingerprintCompare);
    const { json: jsonFlag, 'non-interactive': nonInteractive, buildId: buildIdFromArg } = flags;

    const {
      projectId,
      privateProjectConfig: { projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(FingerprintCompare, {
      nonInteractive,
      withServerSideEnvironment: null,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    let buildId: string | null = buildIdFromArg;
    if (!buildId) {
      if (nonInteractive) {
        throw new Error('Build ID must be provided in non-interactive mode');
      }

      buildId = await selectBuildToCompareAsync(graphqlClient, projectId, displayName, {
        filters: { hasFingerprint: true },
      });
      if (!buildId) {
        return;
      }
    }

    Log.log(`Comparing fingerprints of the current project and build ${buildId}…`);
    const buildWithFingerprint = await BuildQuery.withFingerprintByIdAsync(graphqlClient, buildId);
    const fingerprintDebugUrl = buildWithFingerprint.fingerprint?.debugInfoUrl;
    if (!fingerprintDebugUrl) {
      Log.error('A fingerprint for the build could not be found.');
      return;
    }
    const fingerprintResponse = await fetch(fingerprintDebugUrl);
    const fingerprint = (await fingerprintResponse.json()) as Fingerprint;
    const workflows = await resolveWorkflowPerPlatformAsync(projectDir, vcsClient);
    const buildPlatform = buildWithFingerprint.platform;
    const workflow = workflows[appPlatformToPlatform(buildPlatform)];

    const projectFingerprint = await createFingerprintAsync(projectDir, {
      workflow,
      platforms: [appPlatformToString(buildPlatform)],
      debug: true,
      env: undefined,
    });
    if (!projectFingerprint) {
      Log.error('Project fingerprints can only be computed for projects with SDK 52 or higher');
      return;
    }

    const uploadedFingerprint = await maybeUploadFingerprintAsync({
      hash: fingerprint.hash,
      fingerprint: {
        fingerprintSources: fingerprint.sources,
        isDebugFingerprintSource: Log.isDebug,
      },
      graphqlClient,
    });
    await FingerprintMutation.createFingerprintAsync(graphqlClient, projectId, {
      hash: uploadedFingerprint.hash,
      source: uploadedFingerprint.fingerprintSource,
    });

    if (fingerprint.hash === projectFingerprint.hash) {
      Log.log(`✅ Project fingerprint matches build`);
      return;
    } else {
      Log.log(`🔄 Project fingerprint differs from build`);
    }

    const fingerprintDiffs = diffFingerprint(projectDir, fingerprint, projectFingerprint);
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
