import { Flags } from '@oclif/core';
import openBrowserAsync from 'better-opn';
import chalk from 'chalk';

import { getExpoWebsiteBaseUrl } from '../../api';
import { selectBranchOnAppAsync } from '../../branch/queries';
import { EnvironmentVariableEnvironment } from '../../build/utils/environment';
import EasCommand from '../../commandUtils/EasCommand';
import { fetchBuildsAsync, formatBuild } from '../../commandUtils/builds';
import { GetServerSideEnvironmentVariablesFn } from '../../commandUtils/context/ServerSideEnvironmentVariablesContextField';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasEnvironmentFlagParameters,
  EasNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { diffFingerprint } from '../../fingerprint/cli';
import { abridgedDiff } from '../../fingerprint/diff';
import { Fingerprint, FingerprintDiffItem } from '../../fingerprint/types';
import {
  getFingerprintInfoFromLocalProjectForPlatformsAsync,
  stringToAppPlatform,
} from '../../fingerprint/utils';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  FingerprintFragment,
  UpdateFragment,
} from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { FingerprintQuery } from '../../graphql/queries/FingerprintQuery';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log, { learnMore } from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync, selectAsync } from '../../prompts';
import { selectUpdateGroupOnBranchAsync } from '../../update/queries';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { Client } from '../../vcs/vcs';

enum FingerprintOriginType {
  Build = 'build',
  Update = 'update',
  Hash = 'hash',
  Project = 'project',
}

type FingerprintOrigin = {
  type: FingerprintOriginType;
  build?: BuildFragment;
  update?: UpdateFragment;
};

export default class FingerprintCompare extends EasCommand {
  static override description = 'compare fingerprints of the current project, builds, and updates';
  static override strict = false;

  static override examples = [
    '$ eas fingerprint:compare \t # Compare fingerprints in interactive mode',
    '$ eas fingerprint:compare <FINGERPRINT-HASH> \t # Compare fingerprint against local directory',
    '$ eas fingerprint:compare <FINGERPRINT-HASH-1> <FINGERPRINT-HASH-2> \t # Compare provided fingerprints',
    '$ eas fingerprint:compare --build-id <BUILD-ID> \t # Compare fingerprint from build against local directory',
    '$ eas fingerprint:compare --build-id <BUILD-ID> --environment production \t # Compare fingerprint from build against local directory with the "production" environment',
    '$ eas fingerprint:compare --build-id <BUILD-ID-1> --build-id <BUILD-ID-2>\t # Compare fingerprint from a build against another build',
    '$ eas fingerprint:compare --build-id <BUILD-ID> --update-id <UPDATE-ID>\t # Compare fingerprint from build against fingerprint from update',
    '$ eas fingerprint:compare <FINGERPRINT-HASH> --update-id <UPDATE-ID> \t # Compare fingerprint from update against provided fingerprint',
  ];

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
      multiple: true,
    }),
    'update-id': Flags.string({
      aliases: ['updateId'],
      description: 'Compare the fingerprint with the update with the specified ID',
      multiple: true,
    }),
    open: Flags.boolean({
      description: 'Open the fingerprint comparison in the browser',
    }),
    environment: Flags.enum<EnvironmentVariableEnvironment>({
      ...EasEnvironmentFlagParameters,
      description:
        'If generating a fingerprint from the local directory, use the specified environment.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.ServerSideEnvironmentVariables,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(FingerprintCompare);
    const { hash1, hash2 } = args;
    const {
      json,
      'non-interactive': nonInteractive,
      'build-id': buildIds,
      'update-id': updateIds,
      open,
      environment,
    } = flags;
    const [buildId1, buildId2] = buildIds ?? [];
    const [updateId1, updateId2] = updateIds ?? [];

    const {
      projectId,
      privateProjectConfig: { projectDir },
      loggedIn: { graphqlClient },
      vcsClient,
      getServerSideEnvironmentVariablesAsync,
    } = await this.getContextAsync(FingerprintCompare, {
      nonInteractive,
      withServerSideEnvironment: environment ?? null,
    });
    if (json) {
      enableJsonOutput();
    }

    const firstFingerprintInfo = await getFingerprintInfoAsync(
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      getServerSideEnvironmentVariablesAsync,
      {
        nonInteractive,
        buildId: buildId1,
        updateId: updateId1,
        hash: hash1,
      }
    );
    const { fingerprint: firstFingerprint, origin: firstFingerprintOrigin } = firstFingerprintInfo;

    const isFirstFingerprintSpecifiedByFlagOrArg = hash1 || buildId1 || updateId1;
    const isSecondFingerprintSpecifiedByFlagOrArg = hash2 || buildId2 || updateId2;
    const secondFingerprintInfo = await getFingerprintInfoAsync(
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      getServerSideEnvironmentVariablesAsync,
      {
        nonInteractive,
        buildId: buildId2,
        updateId: updateId2,
        hash: hash2,
        useProjectFingerprint:
          isFirstFingerprintSpecifiedByFlagOrArg && !isSecondFingerprintSpecifiedByFlagOrArg,
        environmentForProjectFingerprint: environment,
      },
      firstFingerprintInfo
    );
    const { fingerprint: secondFingerprint, origin: secondFingerprintOrigin } =
      secondFingerprintInfo;

    if (json) {
      printJsonOnlyOutput({ fingerprint1: firstFingerprint, fingerprint2: secondFingerprint });
      return;
    }

    if (firstFingerprint.hash === secondFingerprint.hash) {
      Log.log(
        `✅ ${capitalizeFirstLetter(
          prettyPrintFingerprint(firstFingerprint, firstFingerprintOrigin)
        )} matches ${prettyPrintFingerprint(secondFingerprint, secondFingerprintOrigin)}`
      );
      return;
    } else {
      Log.log(
        `🔄 ${capitalizeFirstLetter(
          prettyPrintFingerprint(firstFingerprint, firstFingerprintOrigin)
        )} differs from ${prettyPrintFingerprint(secondFingerprint, secondFingerprintOrigin)}`
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

    if (nonInteractive) {
      return;
    }

    const project = await AppQuery.byIdAsync(graphqlClient, projectId);
    const fingerprintCompareUrl = new URL(
      `/accounts/${project.ownerAccount.name}/projects/${project.slug}/fingerprints/compare/${firstFingerprintInfo.fingerprint.hash}/${secondFingerprintInfo.fingerprint.hash}`,
      getExpoWebsiteBaseUrl()
    );

    if (!open) {
      Log.newLine();
      Log.withInfo(
        `💡 Use the --open flag to view the comparison in the browser. ${learnMore(
          fingerprintCompareUrl.toString()
        )}`
      );
      return;
    }
    await openBrowserAsync(fingerprintCompareUrl.toString());
  }
}

async function getFingerprintInfoAsync(
  graphqlClient: ExpoGraphqlClient,
  projectDir: string,
  projectId: string,
  vcsClient: Client,
  getServerSideEnvironmentVariablesAsync: GetServerSideEnvironmentVariablesFn,
  {
    buildId,
    updateId,
    hash,
    useProjectFingerprint,
    environmentForProjectFingerprint,
    nonInteractive,
  }: {
    buildId?: string;
    updateId?: string;
    hash: string;
    useProjectFingerprint?: boolean;
    environmentForProjectFingerprint?: string;
    nonInteractive: boolean;
  },
  firstFingerprintInfo?: {
    fingerprint: Fingerprint;
    platforms?: AppPlatform[];
    origin: FingerprintOrigin;
  }
): Promise<{ fingerprint: Fingerprint; origin: FingerprintOrigin }> {
  if (hash) {
    return await getFingerprintInfoFromHashAsync(graphqlClient, projectId, hash);
  } else if (updateId) {
    return await getFingerprintInfoFromUpdateGroupIdOrUpdateIdAsync(
      graphqlClient,
      projectId,
      nonInteractive,
      updateId
    );
  } else if (buildId) {
    return await getFingerprintInfoFromBuildIdAsync(graphqlClient, buildId);
  } else if (useProjectFingerprint) {
    if (!firstFingerprintInfo) {
      throw new Error(
        'First fingerprint must be provided in order to compare against the project.'
      );
    }
    return await getFingerprintInfoFromLocalProjectAsync({
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      getServerSideEnvironmentVariablesAsync,
      firstFingerprintInfo,
      environment: environmentForProjectFingerprint,
    });
  }

  if (nonInteractive) {
    throw new Error(
      'Insufficent arguments provided for fingerprint comparison in non-interactive mode'
    );
  }
  return await getFingerprintInfoInteractiveAsync({
    graphqlClient,
    projectDir,
    projectId,
    vcsClient,
    getServerSideEnvironmentVariablesAsync,
    firstFingerprintInfo,
    environmentForProjectFingerprint,
  });
}

async function getFingerprintInfoInteractiveAsync({
  graphqlClient,
  projectDir,
  projectId,
  vcsClient,
  getServerSideEnvironmentVariablesAsync,
  firstFingerprintInfo,
  environmentForProjectFingerprint,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  vcsClient: Client;
  getServerSideEnvironmentVariablesAsync: GetServerSideEnvironmentVariablesFn;
  firstFingerprintInfo?: {
    fingerprint: Fingerprint;
    platforms?: AppPlatform[];
    origin: FingerprintOrigin;
  };
  environmentForProjectFingerprint?: string;
}): Promise<{ fingerprint: Fingerprint; platforms?: AppPlatform[]; origin: FingerprintOrigin }> {
  const prompt = firstFingerprintInfo
    ? 'Select the second fingerprint to compare against'
    : 'Select a reference fingerprint for comparison';
  const originType = await selectAsync<FingerprintOriginType>(prompt, [
    ...(firstFingerprintInfo
      ? [{ title: 'Current project fingerprint', value: FingerprintOriginType.Project }]
      : []),
    { title: 'Build fingerprint', value: FingerprintOriginType.Build },
    { title: 'Update fingerprint', value: FingerprintOriginType.Update },
    { title: 'Enter a fingerprint hash manually', value: FingerprintOriginType.Hash },
  ]);
  if (originType === FingerprintOriginType.Project) {
    if (!firstFingerprintInfo) {
      throw new Error(
        'First fingerprint must be provided in order to compare against the project.'
      );
    }
    return await getFingerprintInfoFromLocalProjectAsync({
      graphqlClient,
      projectDir,
      projectId,
      vcsClient,
      getServerSideEnvironmentVariablesAsync,
      firstFingerprintInfo,
      environment: environmentForProjectFingerprint,
    });
  } else if (originType === FingerprintOriginType.Build) {
    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    const buildId = await selectBuildToCompareAsync(graphqlClient, projectId, displayName, {
      filters: { hasFingerprint: true },
    });
    if (!buildId) {
      throw new Error('Must select build with fingerprint for comparison.');
    }
    return await getFingerprintInfoFromBuildIdAsync(graphqlClient, buildId);
  } else if (originType === FingerprintOriginType.Update) {
    const selectedBranch = await selectBranchOnAppAsync(graphqlClient, {
      projectId,
      promptTitle: 'On which branch would you like search for an update?',
      displayTextForListItem: updateBranch => ({
        title: updateBranch.name,
      }),
      paginatedQueryOptions: {
        json: false,
        nonInteractive: false,
        offset: 0,
      },
    });

    const selectedUpdateGroup = await selectUpdateGroupOnBranchAsync(graphqlClient, {
      projectId,
      branchName: selectedBranch.name,
      paginatedQueryOptions: {
        json: false,
        nonInteractive: false,
        offset: 0,
      },
    });
    const updateGroupId = selectedUpdateGroup[0].group;
    return await getFingerprintInfoFromUpdateGroupIdOrUpdateIdAsync(
      graphqlClient,
      projectId,
      false,
      updateGroupId
    );
  } else if (originType === FingerprintOriginType.Hash) {
    const { hash } = await promptAsync({
      type: 'text',
      name: 'hash',
      message: 'Provide the fingerprint hash',
      validate: (value: string) => !!value.trim(),
      hint: '0000000000000000000000000000000000000000',
    });
    return await getFingerprintInfoFromHashAsync(graphqlClient, projectId, hash);
  } else {
    throw new Error(`Unsupported fingerprint origin type: ${originType}`);
  }
}

async function getFingerprintInfoFromLocalProjectAsync({
  graphqlClient,
  projectDir,
  projectId,
  vcsClient,
  getServerSideEnvironmentVariablesAsync,
  firstFingerprintInfo,
  environment,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  vcsClient: Client;
  getServerSideEnvironmentVariablesAsync: GetServerSideEnvironmentVariablesFn;
  firstFingerprintInfo: {
    fingerprint: Fingerprint;
    platforms?: AppPlatform[];
    origin: FingerprintOrigin;
  };
  environment?: string;
}): Promise<{ fingerprint: Fingerprint; platforms?: AppPlatform[]; origin: FingerprintOrigin }> {
  const firstFingerprintPlatforms = firstFingerprintInfo.platforms;
  if (!firstFingerprintPlatforms || firstFingerprintPlatforms.length === 0) {
    throw new Error(
      `Cannot compare the local directory against the provided fingerprint hash "${firstFingerprintInfo.fingerprint.hash}" because the associated platform could not be determined. Ensure the fingerprint is linked to a build or update to identify the platform.`
    );
  }

  if (environment) {
    Log.log(`🔧 Using environment: ${environment}`);
  }
  const env = environment
    ? { ...(await getServerSideEnvironmentVariablesAsync()), EXPO_NO_DOTENV: '1' }
    : undefined;
  const fingerprint = await getFingerprintInfoFromLocalProjectForPlatformsAsync(
    graphqlClient,
    projectDir,
    projectId,
    vcsClient,
    firstFingerprintPlatforms,
    { env }
  );
  return { fingerprint, origin: { type: FingerprintOriginType.Project } };
}

async function getFingerprintFromUpdateFragmentAsync(
  updateWithFingerprint: UpdateFragment
): Promise<{ fingerprint: Fingerprint; platforms?: AppPlatform[]; origin: FingerprintOrigin }> {
  if (!updateWithFingerprint.fingerprint) {
    throw new Error(`Fingerprint for update ${updateWithFingerprint.id} was not computed.`);
  } else if (!updateWithFingerprint.fingerprint.debugInfoUrl) {
    throw new Error(`Fingerprint source for update ${updateWithFingerprint.id} was not computed.`);
  }

  return {
    fingerprint: await getFingerprintFromFingerprintFragmentAsync(
      updateWithFingerprint.fingerprint
    ),
    platforms: [stringToAppPlatform(updateWithFingerprint.platform)],
    origin: {
      type: FingerprintOriginType.Update,
      update: updateWithFingerprint,
    },
  };
}

async function getFingerprintInfoFromHashAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  hash: string
): Promise<{ fingerprint: Fingerprint; platforms?: AppPlatform[]; origin: FingerprintOrigin }> {
  const fingerprintFragment = await getFingerprintFragmentFromHashAsync(
    graphqlClient,
    projectId,
    hash
  );
  const fingerprint = await getFingerprintFromFingerprintFragmentAsync(fingerprintFragment);
  let platforms;
  const fingerprintBuilds = fingerprintFragment.builds?.edges.map(edge => edge.node) ?? [];
  const fingerprintUpdates = fingerprintFragment.updates?.edges.map(edge => edge.node) ?? [];
  if (fingerprintBuilds.length > 0) {
    platforms = [fingerprintBuilds[0].platform];
  } else if (fingerprintUpdates.length > 0) {
    platforms = [stringToAppPlatform(fingerprintUpdates[0].platform)];
  }
  return {
    fingerprint,
    platforms,
    origin: {
      type: FingerprintOriginType.Hash,
    },
  };
}

async function getFingerprintInfoFromUpdateGroupIdOrUpdateIdAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  nonInteractive: boolean,
  updateGroupIdOrUpdateId: string
): Promise<{ fingerprint: Fingerprint; platforms?: AppPlatform[]; origin: FingerprintOrigin }> {
  // Some people may pass in update group id instead of update id, so add interactive support for that
  try {
    const maybeUpdateGroupId = updateGroupIdOrUpdateId;
    const updateGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, {
      groupId: maybeUpdateGroupId,
    });
    if (updateGroup.length === 1) {
      const update = updateGroup[0];
      return await getFingerprintFromUpdateFragmentAsync(update);
    }
    if (nonInteractive) {
      const project = await AppQuery.byIdAsync(graphqlClient, projectId);
      const updateUrl =
        getExpoWebsiteBaseUrl() +
        `/accounts/${project.ownerAccount.name}/projects/${project.slug}/updates/${maybeUpdateGroupId}`;
      throw new Error(
        `Please pass in your update ID from ${updateUrl} or use interactive mode to select the update ID.`
      );
    }
    const update = await selectAsync<UpdateFragment>(
      'Select a platform to compute the fingerprint from',
      updateGroup.map(update => ({
        title: update.platform,
        value: update,
      }))
    );
    return await getFingerprintFromUpdateFragmentAsync(update);
  } catch (error: any) {
    if (!error?.message.includes('Could not find any updates with group ID')) {
      throw error;
    }
  }

  const updateId = updateGroupIdOrUpdateId;
  const updateWithFingerprint = await UpdateQuery.viewByUpdateAsync(graphqlClient, {
    updateId,
  });
  return await getFingerprintFromUpdateFragmentAsync(updateWithFingerprint);
}

async function getFingerprintInfoFromBuildIdAsync(
  graphqlClient: ExpoGraphqlClient,
  buildId: string
): Promise<{ fingerprint: Fingerprint; platforms?: AppPlatform[]; origin: FingerprintOrigin }> {
  const buildWithFingerprint = await BuildQuery.withFingerprintByIdAsync(graphqlClient, buildId);
  if (!buildWithFingerprint.fingerprint) {
    throw new Error(`Fingerprint for build ${buildId} was not computed.`);
  } else if (!buildWithFingerprint.fingerprint.debugInfoUrl) {
    throw new Error(`Fingerprint source for build ${buildId} was not computed.`);
  }
  return {
    fingerprint: await getFingerprintFromFingerprintFragmentAsync(buildWithFingerprint.fingerprint),
    platforms: [buildWithFingerprint.platform],
    origin: {
      type: FingerprintOriginType.Build,
      build: buildWithFingerprint,
    },
  };
}

async function getFingerprintFragmentFromHashAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  hash: string
): Promise<FingerprintFragment> {
  const fingerprint = await FingerprintQuery.byHashAsync(graphqlClient, {
    appId: projectId,
    hash,
  });
  if (!fingerprint) {
    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    throw new Error(`Fingerprint with hash ${hash} was not uploaded for ${displayName}.`);
  }
  return fingerprint;
}

async function getFingerprintFromFingerprintFragmentAsync(
  fingerprintFragment: Pick<FingerprintFragment, 'debugInfoUrl' | 'hash'>
): Promise<Fingerprint> {
  const fingerprintDebugUrl = fingerprintFragment.debugInfoUrl;
  if (!fingerprintDebugUrl) {
    throw new Error(
      `The source for fingerprint hash ${fingerprintFragment.hash} was not computed.`
    );
  }
  const fingerprintResponse = await fetch(fingerprintDebugUrl);
  return (await fingerprintResponse.json()) as Fingerprint;
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
  expoConfig: 'Expo app config',
  'package:react-native': 'React Native package.json',
  'rncoreAutolinkingConfig:ios': 'React Native Community autolinking config (iOS)',
  'rncoreAutolinkingConfig:android': 'React Native Community autolinking config (Android)',
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

function prettyPrintFingerprint(fingerprint: Fingerprint, origin: FingerprintOrigin): string {
  if (origin.type === FingerprintOriginType.Project) {
    return `fingerprint ${fingerprint.hash} from local directory`;
  } else if (origin.type === FingerprintOriginType.Update) {
    return `fingerprint ${fingerprint.hash} from ${
      origin.update?.platform ? stringToAppPlatform(origin.update?.platform) : ''
    } ${origin.type}`;
  } else if (origin.type === FingerprintOriginType.Build) {
    return `fingerprint ${fingerprint.hash} from ${origin.build?.platform} ${origin.type}`;
  }
  return `fingerprint ${fingerprint.hash}`;
}

function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function isJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

async function selectBuildToCompareAsync(
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
