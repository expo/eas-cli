import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import prompts from 'prompts';
import { URL } from 'url';
import * as uuid from 'uuid';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { BuildFragment } from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log, { learnMore } from '../log';
import { appPlatformDisplayNames } from '../platform';
import { confirmAsync, promptAsync } from '../prompts';
import { fromNow } from '../utils/date';
import { getRecentBuildsForSubmissionAsync } from './utils/builds';
import { isExistingFileAsync, uploadAppArchiveAsync } from './utils/files';

export const BUILD_LIST_ITEM_COUNT = 4;

export enum ArchiveSourceType {
  url,
  latest,
  path,
  buildId,
  buildList,
  prompt,
}

interface ArchiveSourceBase {
  sourceType: ArchiveSourceType;
  platform: Platform;
  projectId: string;
  nonInteractive: boolean;
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

interface ArchiveBuildListSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.buildList;
}

interface ArchivePromptSource extends ArchiveSourceBase {
  sourceType: ArchiveSourceType.prompt;
}

export interface Archive {
  build?: BuildFragment;
  source: ArchiveSource;
  url?: string;
}

export type ArchiveSource =
  | ArchiveUrlSource
  | ArchiveLatestSource
  | ArchivePathSource
  | ArchiveBuildIdSource
  | ArchiveBuildListSource
  | ArchivePromptSource;

export async function getArchiveAsync(
  graphqlClient: ExpoGraphqlClient,
  source: ArchiveSource
): Promise<Archive> {
  switch (source.sourceType) {
    case ArchiveSourceType.prompt: {
      return await handlePromptSourceAsync(graphqlClient, source);
    }
    case ArchiveSourceType.url: {
      return await handleUrlSourceAsync(graphqlClient, source);
    }
    case ArchiveSourceType.latest: {
      return await handleLatestSourceAsync(graphqlClient, source);
    }
    case ArchiveSourceType.path: {
      return await handlePathSourceAsync(graphqlClient, source);
    }
    case ArchiveSourceType.buildId: {
      return await handleBuildIdSourceAsync(graphqlClient, source);
    }
    case ArchiveSourceType.buildList: {
      return await handleBuildListSourceAsync(graphqlClient, source);
    }
  }
}

async function handleUrlSourceAsync(
  graphqlClient: ExpoGraphqlClient,
  source: ArchiveUrlSource
): Promise<Archive> {
  const { url } = source;

  if (!validateUrl(url)) {
    Log.error(chalk.bold(`The URL you provided is invalid: ${url}`));
    return getArchiveAsync(graphqlClient, {
      ...source,
      sourceType: ArchiveSourceType.prompt,
    });
  }

  const maybeBuildId = isBuildDetailsPage(url);
  if (maybeBuildId) {
    if (await askIfUseBuildIdFromUrlAsync(source, maybeBuildId)) {
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.buildId,
        id: maybeBuildId,
      });
    }
  }

  return {
    url,
    source,
  };
}

async function handleLatestSourceAsync(
  graphqlClient: ExpoGraphqlClient,
  source: ArchiveLatestSource
): Promise<Archive> {
  try {
    const [latestBuild] = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      toAppPlatform(source.platform),
      source.projectId
    );

    if (!latestBuild) {
      Log.error(
        chalk.bold(
          "Couldn't find any builds for this project on EAS servers. It looks like you haven't run 'eas build' yet."
        )
      );
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.prompt,
      });
    }

    return {
      build: latestBuild,
      source,
    };
  } catch (err) {
    Log.error(err);
    throw err;
  }
}

async function handlePathSourceAsync(
  graphqlClient: ExpoGraphqlClient,
  source: ArchivePathSource
): Promise<Archive> {
  if (!(await isExistingFileAsync(source.path))) {
    Log.error(chalk.bold(`${source.path} doesn't exist`));
    return getArchiveAsync(graphqlClient, {
      ...source,
      sourceType: ArchiveSourceType.prompt,
    });
  }

  Log.log('Uploading your app archive to EAS Submit');
  const uploadUrl = await uploadAppArchiveAsync(graphqlClient, source.path);
  return {
    url: uploadUrl,
    source,
  };
}

async function handleBuildIdSourceAsync(
  graphqlClient: ExpoGraphqlClient,
  source: ArchiveBuildIdSource
): Promise<Archive> {
  try {
    const build = await BuildQuery.byIdAsync(graphqlClient, source.id);

    if (build.platform !== toAppPlatform(source.platform)) {
      const expectedPlatformName = appPlatformDisplayNames[toAppPlatform(source.platform)];
      const receivedPlatformName = appPlatformDisplayNames[build.platform];
      Log.error(
        chalk.bold(
          `Build platform doesn't match! Expected ${expectedPlatformName} build but got ${receivedPlatformName}.`
        )
      );

      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.prompt,
      });
    }

    return {
      build,
      source,
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

    return getArchiveAsync(graphqlClient, {
      ...source,
      sourceType: ArchiveSourceType.prompt,
    });
  }
}

async function handleBuildListSourceAsync(
  graphqlClient: ExpoGraphqlClient,
  source: ArchiveBuildListSource
): Promise<Archive> {
  try {
    const appPlatform = toAppPlatform(source.platform);
    const expiryDate = new Date(); // artifacts expire after 30 days
    expiryDate.setDate(expiryDate.getDate() - 30);

    const recentBuilds = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      appPlatform,
      source.projectId,
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
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.prompt,
      });
    }

    if (recentBuilds.every(it => new Date(it.updatedAt) < expiryDate)) {
      Log.error(
        chalk.bold(
          'It looks like all of your build artifacts have expired. ' +
            'EAS keeps your build artifacts only for 30 days.'
        )
      );
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.prompt,
      });
    }

    const choices = recentBuilds.map(build => formatBuildChoice(build, expiryDate));
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
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.prompt,
      });
    }

    return {
      build: selectedBuild,
      source,
    };
  } catch (err) {
    Log.error(err);
    throw err;
  }
}

function formatBuildChoice(build: BuildFragment, expiryDate: Date): prompts.Choice {
  const { id, updatedAt, runtimeVersion, buildProfile, gitCommitHash, gitCommitMessage, channel } =
    build;

  const formatValue = (field?: string | null): string =>
    field ? chalk.bold(field) : chalk.dim('Unknown');

  const buildDate = new Date(updatedAt);

  const formattedCommitData =
    gitCommitHash && gitCommitMessage
      ? `${chalk.dim(gitCommitHash.slice(0, 7))} "${chalk.bold(gitCommitMessage)}"`
      : 'Unknown';

  const title = `ID: ${chalk.dim(id)} (${chalk.dim(`${fromNow(buildDate)} ago`)})`;

  const description = [
    `\tProfile: ${formatValue(buildProfile)}`,
    `\tChannel: ${formatValue(channel)}`,
    `\tRuntime version: ${formatValue(runtimeVersion)}`,
    `\tCommit: ${formattedCommitData}`,
  ].join('\n');

  return {
    title,
    description,
    value: build,
    disabled: buildDate < expiryDate,
  };
}

async function handlePromptSourceAsync(
  graphqlClient: ExpoGraphqlClient,
  source: ArchivePromptSource
): Promise<Archive> {
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
      const url = await askForArchiveUrlAsync(source.platform);
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.url,
        url,
      });
    }
    case ArchiveSourceType.path: {
      const path = await askForArchivePathAsync(source.platform);
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.path,
        path,
      });
    }
    case ArchiveSourceType.buildList: {
      return getArchiveAsync(graphqlClient, {
        ...source,
        sourceType: ArchiveSourceType.buildList,
      });
    }
    case ArchiveSourceType.buildId: {
      const id = await askForBuildIdAsync();
      return getArchiveAsync(graphqlClient, {
        ...source,
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
  source: ArchiveUrlSource,
  buildId: string
): Promise<boolean> {
  const { url } = source;
  Log.warn(`It seems that you provided a build details page URL: ${url}`);
  Log.warn('We expected to see the build artifact URL.');
  if (!source.nonInteractive) {
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
