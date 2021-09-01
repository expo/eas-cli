import chalk from 'chalk';
import { URL, parse as parseUrl } from 'url';
import * as uuid from 'uuid';

import { AppPlatform, BuildFragment } from '../graphql/generated';
import Log from '../log';
import { promptAsync } from '../prompts';
import { getBuildByIdForSubmissionAsync, getLatestBuildForSubmissionAsync } from './utils/builds';
import { isExistingFile, uploadAppArchiveAsync } from './utils/files';

export enum ArchiveSourceType {
  url,
  latest,
  path,
  buildId,
  prompt,
}

interface ArchiveSourceBase {
  sourceType: ArchiveSourceType;
  platform: AppPlatform;
  projectId: string;
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
  url: string;
}

export type ArchiveSource =
  | ArchiveUrlSource
  | ArchiveLatestSource
  | ArchivePathSource
  | ArchiveBuildIdSource
  | ArchivePromptSource;

export async function getArchiveAsync(source: ArchiveSource): Promise<Archive> {
  switch (source.sourceType) {
    case ArchiveSourceType.prompt:
      return await handlePromptSourceAsync(source);
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
  if (!validateUrl(source.url)) {
    Log.error(chalk.bold(`The URL you provided is invalid: ${source.url}`));
    return getArchiveAsync({
      ...source,
      sourceType: ArchiveSourceType.prompt,
    });
  }

  return {
    url: source.url,
    source,
  };
}

async function handleLatestSourceAsync(source: ArchiveLatestSource): Promise<Archive> {
  try {
    const latestBuild = await getLatestBuildForSubmissionAsync(source.platform, source.projectId);

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
      url: latestBuild.artifacts.buildUrl,
      source,
    };
  } catch (err) {
    Log.error(err);
    throw err;
  }
}

async function handlePathSourceAsync(source: ArchivePathSource): Promise<Archive> {
  if (!(await isExistingFile(source.path))) {
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
    const build = await getBuildByIdForSubmissionAsync(source.platform, source.id);
    return {
      build,
      source,
      url: build.artifacts.buildUrl,
    };
  } catch (err) {
    Log.error(chalk.bold(`Couldn't find build for id ${source.id}`));
    Log.error(err);
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
        title: 'Latest build from EAS',
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

/* PROMPTS */

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

async function askForArchivePathAsync(platform: AppPlatform): Promise<string> {
  const isIos = platform === AppPlatform.Ios;
  const defaultArchivePath = `/path/to/your/archive.${isIos ? 'ipa' : 'aab'}`;
  const { path } = await promptAsync({
    name: 'path',
    message: `Path to the app archive file (${isIos ? 'ipa' : 'aab or apk'}):`,
    initial: defaultArchivePath,
    type: 'text',
    validate: async (path: string): Promise<boolean | string> => {
      if (path === defaultArchivePath) {
        return 'That was just an example path, meant to show you the format that we expect for the response.';
      } else if (!(await isExistingFile(path))) {
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
      if (!uuid.validate(val)) {
        return `${val} is not a valid id`;
      } else {
        return true;
      }
    },
  });
  return id;
}

function validateUrl(url: string): boolean {
  const protocols = ['http', 'https'];
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    const parsed = parseUrl(url);
    return protocols
      ? parsed.protocol
        ? protocols.map(x => `${x.toLowerCase()}:`).includes(parsed.protocol)
        : false
      : true;
  } catch (err) {
    return false;
  }
}
