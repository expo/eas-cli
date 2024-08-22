import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import prompts from 'prompts';
import { URL } from 'url';
import * as uuid from 'uuid';

import { getRecentBuildsForSubmissionAsync } from './utils/builds';
import { isExistingFileAsync, uploadAppArchiveAsync } from './utils/files';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { BuildFragment } from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log, { learnMore } from '../log';
import { appPlatformDisplayNames } from '../platform';
import { confirmAsync, promptAsync } from '../prompts';
import { fromNow } from '../utils/date';

export const BUILD_LIST_ITEM_COUNT = 4;

export enum ArchiveSourceType {
  url,
  latest,
  path,
  buildId,
  build,
  buildList,
  prompt,
  gcs,
}

export interface ArchiveResolverContext {
  platform: Platform;
  projectId: string;
  nonInteractive: boolean;
  graphqlClient: ExpoGraphqlClient;
}

interface ArchiveSourceBase {
  sourceType: ArchiveSourceType;
}

interface ArchiveUrlSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.url;
  url: string;
}

interface ArchiveLatestSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.latest;
}

interface ArchivePathSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.path;
  path: string;
}

interface ArchiveBuildIdSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.buildId;
  id: string;
}

interface ArchiveBuildSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.build;
  build: BuildFragment;
}

interface ArchiveBuildListSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.buildList;
}

interface ArchivePromptSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.prompt;
}

interface ArchiveGCSSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.gcs;
  bucketKey: string;
  localSource: ArchivePathSource;
}

export type ArchiveSource =
  | ArchiveUrlSource
  | ArchiveLatestSource
  | ArchivePathSource
  | ArchiveBuildIdSource
  | ArchiveBuildSource
  | ArchiveBuildListSource
  | ArchivePromptSource
  | ArchiveGCSSource;

export type ResolvedArchiveSource = ArchiveUrlSource | ArchiveGCSSource | ArchiveBuildSource;

export async function getArchiveAsync(
  ctx: ArchiveResolverContext,
  source: ArchiveSource
): Promise<ResolvedArchiveSource> {
  switch (source.sourceType) {
    case ArchiveSourceType.prompt: {
      return await handlePromptSourceAsync(ctx);
    }
    case ArchiveSourceType.url: {
      return await handleUrlSourceAsync(ctx, source);
    }
    case ArchiveSourceType.latest: {
      return await handleLatestSourceAsync(ctx);
    }
    case ArchiveSourceType.path: {
      return await handlePathSourceAsync(ctx, source);
    }
    case ArchiveSourceType.buildId: {
      return await handleBuildIdSourceAsync(ctx, source);
    }
    case ArchiveSourceType.buildList: {
      return await handleBuildListSourceAsync(ctx);
    }
    case ArchiveSourceType.gcs: {
      return source;
    }
    case ArchiveSourceType.build: {
      return source;
    }
  }
}

async function handleUrlSourceAsync(
  ctx: ArchiveResolverContext,
  source: ArchiveUrlSource
): Promise<ResolvedArchiveSource> {
  const { url } = source;

  if (!validateUrl(url)) {
    Log.error(chalk.bold(`The URL you provided is invalid: ${url}`));
    return await getArchiveAsync(ctx, {
      sourceType: ArchiveSourceType.prompt,
    });
  }

  const maybeBuildId = isBuildDetailsPage(url);
  if (maybeBuildId) {
    if (await askIfUseBuildIdFromUrlAsync(ctx, source, maybeBuildId)) {
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.buildId,
        id: maybeBuildId,
      });
    }
  }

  return {
    sourceType: ArchiveSourceType.url,
    url,
  };
}

async function handleLatestSourceAsync(
  ctx: ArchiveResolverContext
): Promise<ResolvedArchiveSource> {
  try {
    const [latestBuild] = await getRecentBuildsForSubmissionAsync(
      ctx.graphqlClient,
      toAppPlatform(ctx.platform),
      ctx.projectId
    );

    if (!latestBuild) {
      Log.error(
        chalk.bold(
          "Couldn't find any builds for this project on EAS servers. It looks like you haven't run 'eas build' yet."
        )
      );
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.prompt,
      });
    }

    if (new Date() >= new Date(latestBuild.expirationDate)) {
      Log.error(
        chalk.bold(
          `The latest build is expired. Run ${chalk.bold(
            'eas build --auto-submit'
          )} or choose another build.`
        )
      );
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.prompt,
      });
    }

    return {
      sourceType: ArchiveSourceType.build,
      build: latestBuild,
    };
  } catch (err) {
    Log.error(err);
    throw err;
  }
}

async function handlePathSourceAsync(
  ctx: ArchiveResolverContext,
  source: ArchivePathSource
): Promise<ResolvedArchiveSource> {
  if (!(await isExistingFileAsync(source.path))) {
    Log.error(chalk.bold(`${source.path} doesn't exist`));
    return await getArchiveAsync(ctx, {
      sourceType: ArchiveSourceType.prompt,
    });
  }

  Log.log('Uploading your app archive to EAS Submit');
  const bucketKey = await uploadAppArchiveAsync(ctx.graphqlClient, source.path);
  return {
    sourceType: ArchiveSourceType.gcs,
    bucketKey,
    localSource: {
      sourceType: ArchiveSourceType.path,
      path: source.path,
    },
  };
}

async function handleBuildIdSourceAsync(
  ctx: ArchiveResolverContext,
  source: ArchiveBuildIdSource
): Promise<ResolvedArchiveSource> {
  try {
    const build = await BuildQuery.byIdAsync(ctx.graphqlClient, source.id);

    if (build.platform !== toAppPlatform(ctx.platform)) {
      const expectedPlatformName = appPlatformDisplayNames[toAppPlatform(ctx.platform)];
      const receivedPlatformName = appPlatformDisplayNames[build.platform];
      Log.error(
        chalk.bold(
          `Build platform doesn't match! Expected ${expectedPlatformName} build but got ${receivedPlatformName}.`
        )
      );

      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.prompt,
      });
    }

    if (new Date() >= new Date(build.expirationDate)) {
      Log.error(chalk.bold(`The build with ID ${build.id} is expired. Choose another build.`));
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.prompt,
      });
    }

    return {
      sourceType: ArchiveSourceType.build,
      build,
    };
  } catch (err) {
    Log.error(chalk.bold(`Could not find build with ID ${source.id}`));
    Log.warn('Are you sure that the given ID corresponds to a build from EAS Build?');
    Log.warn(
      `Build IDs from the classic build service (expo build:[android|ios]) are not supported. ${learnMore(
        'https://docs.expo.dev/submit/classic-builds/'
      )}`
    );
    Log.debug('Original error:', err);

    return await getArchiveAsync(ctx, {
      sourceType: ArchiveSourceType.prompt,
    });
  }
}

async function handleBuildListSourceAsync(
  ctx: ArchiveResolverContext
): Promise<ResolvedArchiveSource> {
  try {
    const appPlatform = toAppPlatform(ctx.platform);

    const recentBuilds = await getRecentBuildsForSubmissionAsync(
      ctx.graphqlClient,
      appPlatform,
      ctx.projectId,
      {
        limit: BUILD_LIST_ITEM_COUNT,
      }
    );

    if (recentBuilds.length < 1) {
      Log.error(
        chalk.bold(
          `Couldn't find any ${appPlatformDisplayNames[appPlatform]} builds for this project on EAS servers. ` +
            "It looks like you haven't run 'eas build' yet."
        )
      );
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.prompt,
      });
    }

    if (recentBuilds.every(it => new Date(it.expirationDate) <= new Date())) {
      Log.error(
        chalk.bold(
          'It looks like all of your build artifacts have expired. ' +
            'EAS keeps your build artifacts only for 30 days.'
        )
      );
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.prompt,
      });
    }

    const choices = recentBuilds.map(build => formatBuildChoice(build));
    choices.push({
      title: 'None of the above (select another option)',
      value: null,
    });

    const { selectedBuild } = await promptAsync({
      name: 'selectedBuild',
      type: 'select',
      message: 'Which build would you like to submit?',
      choices: choices.map(choice => ({ ...choice, title: `- ${choice.title}` })),
      warn: 'This artifact has expired',
    });

    if (selectedBuild == null) {
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.prompt,
      });
    }

    return {
      sourceType: ArchiveSourceType.build,
      build: selectedBuild,
    };
  } catch (err) {
    Log.error(err);
    throw err;
  }
}

function formatBuildChoice(build: BuildFragment): prompts.Choice {
  const {
    id,
    updatedAt,
    runtimeVersion,
    buildProfile,
    gitCommitHash,
    gitCommitMessage,
    channel,
    message,
  } = build;
  const buildDate = new Date(updatedAt);

  const splitCommitMessage = gitCommitMessage?.split('\n');
  const formattedCommitData =
    gitCommitHash && splitCommitMessage && splitCommitMessage.length > 0
      ? `${gitCommitHash.slice(0, 7)} "${chalk.bold(
          splitCommitMessage[0] + (splitCommitMessage.length > 1 ? '…' : '')
        )}"`
      : null;

  const title = `${chalk.bold(`ID:`)} ${id} (${chalk.bold(`${fromNow(buildDate)} ago`)})`;

  const descriptionItems: { name: string; value: string | null }[] = [
    { name: 'Profile', value: buildProfile ? chalk.bold(buildProfile) : null },
    { name: 'Channel', value: channel ? chalk.bold(channel) : null },
    { name: 'Runtime version', value: runtimeVersion ? chalk.bold(runtimeVersion) : null },
    { name: 'Commit', value: formattedCommitData },
    {
      name: 'Message',
      value: message
        ? chalk.bold(message.length > 200 ? `${message.slice(0, 200)}...` : message)
        : null,
    },
  ];

  const filteredDescriptionArray: string[] = descriptionItems
    .filter(item => item.value)
    .map(item => `${chalk.bold(item.name)}: ${item.value}`);

  return {
    title,
    description: filteredDescriptionArray.length > 0 ? filteredDescriptionArray.join('\n') : '',
    value: build,
    disabled: new Date(build.expirationDate) < new Date(),
  };
}

async function handlePromptSourceAsync(
  ctx: ArchiveResolverContext
): Promise<ResolvedArchiveSource> {
  const { sourceType: sourceTypeRaw } = await promptAsync({
    name: 'sourceType',
    type: 'select',
    message: 'What would you like to submit?',
    choices: [
      {
        title: 'Select a build from EAS',
        value: ArchiveSourceType.buildList,
      },
      { title: 'Provide a URL to the app archive', value: ArchiveSourceType.url },
      {
        title: 'Provide a path to a local app binary file',
        value: ArchiveSourceType.path,
      },
      {
        title: 'Provide a build ID to identify a build on EAS',
        value: ArchiveSourceType.buildId,
      },
    ],
  });
  const sourceType = sourceTypeRaw as ArchiveSourceType;
  switch (sourceType) {
    case ArchiveSourceType.url: {
      const url = await askForArchiveUrlAsync(ctx.platform);
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.url,
        url,
      });
    }
    case ArchiveSourceType.path: {
      const path = await askForArchivePathAsync(ctx.platform);
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.path,
        path,
      });
    }
    case ArchiveSourceType.buildList: {
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.buildList,
      });
    }
    case ArchiveSourceType.buildId: {
      const id = await askForBuildIdAsync();
      return await getArchiveAsync(ctx, {
        sourceType: ArchiveSourceType.buildId,
        id,
      });
    }
    default:
      throw new Error('This should never happen');
  }
}

async function askForArchiveUrlAsync(platform: Platform): Promise<string> {
  const isIos = platform === Platform.IOS;
  const defaultArchiveUrl = `https://url.to/your/archive.${isIos ? 'ipa' : 'aab'}`;
  const { url } = await promptAsync({
    name: 'url',
    message: 'URL:',
    initial: defaultArchiveUrl,
    type: 'text',
    validate: (url: string): string | boolean => {
      if (url === defaultArchiveUrl) {
        return 'That was just an example URL, meant to show you the format that we expect for the response.';
      } else if (!validateUrl(url)) {
        return `${url} does not conform to HTTP format`;
      } else {
        return true;
      }
    },
  });
  return url;
}

async function askForArchivePathAsync(platform: Platform): Promise<string> {
  const isIos = platform === Platform.IOS;
  const defaultArchivePath = `/path/to/your/archive.${isIos ? 'ipa' : 'aab'}`;
  const { path } = await promptAsync({
    name: 'path',
    message: `Path to the app archive file (${isIos ? 'ipa' : 'aab or apk'}):`,
    initial: defaultArchivePath,
    type: 'text',
    // eslint-disable-next-line async-protect/async-suffix
    validate: async (path: string): Promise<boolean | string> => {
      if (path === defaultArchivePath) {
        return 'That was just an example path, meant to show you the format that we expect for the response.';
      } else if (!(await isExistingFileAsync(path))) {
        return `File ${path} doesn't exist.`;
      } else {
        return true;
      }
    },
  });
  return path;
}

async function askForBuildIdAsync(): Promise<string> {
  const { id } = await promptAsync({
    name: 'id',
    message: 'Build ID:',
    type: 'text',
    validate: (val: string): string | boolean => {
      if (!isUuidV4(val)) {
        return `${val} is not a valid ID`;
      } else {
        return true;
      }
    },
  });
  return id;
}

async function askIfUseBuildIdFromUrlAsync(
  ctx: ArchiveResolverContext,
  source: ArchiveUrlSource,
  buildId: string
): Promise<boolean> {
  const { url } = source;
  Log.warn(`It seems that you provided a build details page URL: ${url}`);
  Log.warn('We expected to see the build artifact URL.');
  if (!ctx.nonInteractive) {
    const useAsBuildId = await confirmAsync({
      message: `Do you want to submit build ${buildId} instead?`,
    });
    if (useAsBuildId) {
      return true;
    } else {
      Log.warn('The submission will most probably fail.');
    }
  } else {
    Log.warn("Proceeding because you've run this command in non-interactive mode.");
  }
  return false;
}

function isBuildDetailsPage(url: string): string | false {
  const maybeExpoUrl = url.match(/expo\.(dev|io).*\/builds\/(.{36}).*/);
  if (maybeExpoUrl) {
    const maybeBuildId = maybeExpoUrl[2];
    if (isUuidV4(maybeBuildId)) {
      return maybeBuildId;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function validateUrl(url: string): boolean {
  const protocols = ['http', 'https'];
  try {
    const parsed = new URL(url);
    return protocols
      ? parsed.protocol
        ? protocols.map(x => `${x.toLowerCase()}:`).includes(parsed.protocol)
        : false
      : true;
  } catch {
    return false;
  }
}

export function isUuidV4(s: string): boolean {
  return uuid.validate(s) && uuid.version(s) === 4;
}
