import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import { URL } from 'url';
import * as uuid from 'uuid';

import { BuildFragment } from '../graphql/generated';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import { confirmAsync, promptAsync } from '../prompts';
import { getBuildByIdForSubmissionAsync, getLatestBuildForSubmissionAsync } from './utils/builds';
import { isExistingFileAsync, uploadAppArchiveAsync } from './utils/files';

export enum ArchiveSourceType {
  url,
  latest,
  path,
  buildId,
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
  | ArchivePromptSource;

export async function getArchiveAsync(source: ArchiveSource): Promise<Archive> {
  switch (source.sourceType) {
    case ArchiveSourceType.prompt: {
      return await handlePromptSourceAsync(source);
    }
    case ArchiveSourceType.url: {
      return await handleUrlSourceAsync(source);
    }
    case ArchiveSourceType.latest: {
      return await handleLatestSourceAsync(source);
    }
    case ArchiveSourceType.path: {
      return await handlePathSourceAsync(source);
    }
    case ArchiveSourceType.buildId: {
      return await handleBuildIdSourceAsync(source);
    }
  }
}

async function handleUrlSourceAsync(source: ArchiveUrlSource): Promise<Archive> {
  const { url } = source;

  if (!validateUrl(url)) {
    Log.error(chalk.bold(`The URL you provided is invalid: ${url}`));
    return getArchiveAsync({
      ...source,
      sourceType: ArchiveSourceType.prompt,
    });
  }

  const maybeBuildId = isBuildDetailsPage(url);
  if (maybeBuildId) {
    if (await askIfUseBuildIdFromUrlAsync(source, maybeBuildId)) {
      return getArchiveAsync({
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

async function handleLatestSourceAsync(source: ArchiveLatestSource): Promise<Archive> {
  try {
    const latestBuild = await getLatestBuildForSubmissionAsync(
      toAppPlatform(source.platform),
      source.projectId
    );

    if (!latestBuild) {
      Log.error(
        chalk.bold(
          "Couldn't find any builds for this project on EAS servers. It looks like you haven't run 'eas build' yet."
        )
      );
      return getArchiveAsync({
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

async function handlePathSourceAsync(source: ArchivePathSource): Promise<Archive> {
  if (!(await isExistingFileAsync(source.path))) {
    Log.error(chalk.bold(`${source.path} doesn't exist`));
    return getArchiveAsync({
      ...source,
      sourceType: ArchiveSourceType.prompt,
    });
  }

  Log.log('Uploading your app archive to the Expo Submission Service');
  const uploadUrl = await uploadAppArchiveAsync(source.path);
  return {
    url: uploadUrl,
    source,
  };
}

async function handleBuildIdSourceAsync(source: ArchiveBuildIdSource): Promise<Archive> {
  try {
    const build = await getBuildByIdForSubmissionAsync(toAppPlatform(source.platform), source.id);
    return {
      build,
      source,
    };
  } catch (err) {
    Log.error(chalk.bold(`Could not find build with id ${source.id}`));
    Log.warn(
      'Are you sure you did not pass the build id from the legacy build service (expo build:(android|ios))?'
    );
    Log.warn('Only EAS Build build ids are supported.');
    return getArchiveAsync({
      ...source,
      sourceType: ArchiveSourceType.prompt,
    });
  }
}

async function handlePromptSourceAsync(source: ArchivePromptSource): Promise<Archive> {
  const { sourceType: sourceTypeRaw } = await promptAsync({
    name: 'sourceType',
    type: 'select',
    message: 'What would you like to submit?',
    choices: [
      {
        title: 'Latest finished build from EAS',
        value: ArchiveSourceType.latest,
      },
      { title: 'I have a url to the app archive', value: ArchiveSourceType.url },
      {
        title: 'Local app binary file',
        value: ArchiveSourceType.path,
      },
      {
        title: 'A build identified by a build id',
        value: ArchiveSourceType.buildId,
      },
    ],
  });
  const sourceType = sourceTypeRaw as ArchiveSourceType;
  switch (sourceType) {
    case ArchiveSourceType.url: {
      const url = await askForArchiveUrlAsync();
      return getArchiveAsync({
        ...source,
        sourceType: ArchiveSourceType.url,
        url,
      });
    }
    case ArchiveSourceType.path: {
      const path = await askForArchivePathAsync(source.platform);
      return getArchiveAsync({
        ...source,
        sourceType: ArchiveSourceType.path,
        path,
      });
    }
    case ArchiveSourceType.latest: {
      return getArchiveAsync({
        ...source,
        sourceType: ArchiveSourceType.latest,
      });
    }
    case ArchiveSourceType.buildId: {
      const id = await askForBuildIdAsync();
      return getArchiveAsync({
        ...source,
        sourceType: ArchiveSourceType.buildId,
        id,
      });
    }
    case ArchiveSourceType.prompt:
      throw new Error('This should never happen');
  }
}

async function askForArchiveUrlAsync(): Promise<string> {
  const defaultArchiveUrl = 'https://url.to/your/archive.aab';
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
  } catch (err) {
    return false;
  }
}

export function isUuidV4(s: string): boolean {
  return uuid.validate(s) && uuid.version(s) === 4;
}
