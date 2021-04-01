import chalk from 'chalk';
import { URL, parse as parseUrl } from 'url';
import * as uuid from 'uuid';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import { SubmissionPlatform } from '../types';
import { getBuildArtifactUrlByIdAsync, getLatestBuildArtifactUrlAsync } from '../utils/builds';
import { isExistingFile, uploadAppArchiveAsync } from '../utils/files';

export enum ArchiveFileSourceType {
  url,
  latest,
  path,
  buildId,
  prompt,
}

interface ArchiveFileSourceBase {
  sourceType: ArchiveFileSourceType;
  projectDir: string;
  platform: SubmissionPlatform;
  projectId: string;
}

interface ArchiveFileUrlSource extends ArchiveFileSourceBase {
  sourceType: ArchiveFileSourceType.url;
  url: string;
}

interface ArchiveFileLatestSource extends ArchiveFileSourceBase {
  sourceType: ArchiveFileSourceType.latest;
}

interface ArchiveFilePathSource extends ArchiveFileSourceBase {
  sourceType: ArchiveFileSourceType.path;
  path: string;
}

interface ArchiveFileBuildIdSource extends ArchiveFileSourceBase {
  sourceType: ArchiveFileSourceType.buildId;
  id: string;
}

interface ArchiveFilePromptSource extends ArchiveFileSourceBase {
  sourceType: ArchiveFileSourceType.prompt;
}

export interface ResolvedArchive {
  location: string;
  realSource: ArchiveFileSource;
}

export type ArchiveFileSource =
  | ArchiveFileUrlSource
  | ArchiveFileLatestSource
  | ArchiveFilePathSource
  | ArchiveFileBuildIdSource
  | ArchiveFilePromptSource;

export async function getArchiveFileLocationAsync(
  source: ArchiveFileSource
): Promise<ResolvedArchive> {
  switch (source.sourceType) {
    case ArchiveFileSourceType.prompt:
      return await handlePromptSourceAsync(source);
    case ArchiveFileSourceType.url: {
      return await handleUrlSourceAsync(source);
    }
    case ArchiveFileSourceType.latest: {
      return await handleLatestSourceAsync(source);
    }
    case ArchiveFileSourceType.path: {
      return await handlePathSourceAsync(source);
    }
    case ArchiveFileSourceType.buildId: {
      return await handleBuildIdSourceAsync(source);
    }
  }
}

async function handleUrlSourceAsync(source: ArchiveFileUrlSource): Promise<ResolvedArchive> {
  if (!validateUrl(source.url)) {
    Log.error(chalk.bold(`The URL you provided is invalid: ${source.url}`));
    return getArchiveFileLocationAsync({
      ...source,
      sourceType: ArchiveFileSourceType.prompt,
    });
  }

  return {
    location: source.url,
    realSource: source,
  };
}

async function handleLatestSourceAsync(source: ArchiveFileLatestSource): Promise<ResolvedArchive> {
  try {
    const artifactUrl = await getLatestBuildArtifactUrlAsync(source.platform, source.projectId);

    if (!artifactUrl) {
      Log.error(
        chalk.bold(
          "Couldn't find any builds for this project on EAS servers. It looks like you haven't run 'eas build' yet."
        )
      );
      return getArchiveFileLocationAsync({
        ...source,
        sourceType: ArchiveFileSourceType.prompt,
      });
    }

    return {
      location: artifactUrl,
      realSource: source,
    };
  } catch (err) {
    Log.error(err);
    throw err;
  }
}

async function handlePathSourceAsync(source: ArchiveFilePathSource): Promise<ResolvedArchive> {
  if (!(await isExistingFile(source.path))) {
    Log.error(chalk.bold(`${source.path} doesn't exist`));
    return getArchiveFileLocationAsync({
      ...source,
      sourceType: ArchiveFileSourceType.prompt,
    });
  }

  Log.log('Uploading your app archive to the Expo Submission Service');
  const uploadUrl = await uploadAppArchiveAsync(source.path);
  return {
    location: uploadUrl,
    realSource: source,
  };
}

async function handleBuildIdSourceAsync(
  source: ArchiveFileBuildIdSource
): Promise<ResolvedArchive> {
  try {
    return {
      location: await getBuildArtifactUrlByIdAsync(source.platform, source.id),
      realSource: source,
    };
  } catch (err) {
    Log.error(chalk.bold(`Couldn't find build for id ${source.id}`));
    Log.error(err);
    return getArchiveFileLocationAsync({
      ...source,
      sourceType: ArchiveFileSourceType.prompt,
    });
  }
}

async function handlePromptSourceAsync(source: ArchiveFilePromptSource): Promise<ResolvedArchive> {
  const { sourceType: sourceTypeRaw } = await promptAsync({
    name: 'sourceType',
    type: 'select',
    message: 'What would you like to submit?',
    choices: [
      {
        title: 'Latest build from EAS',
        value: ArchiveFileSourceType.latest,
      },
      { title: 'I have a url to the app archive', value: ArchiveFileSourceType.url },
      {
        title: 'Local app binary file',
        value: ArchiveFileSourceType.path,
      },
      {
        title: 'A build identified by a build id',
        value: ArchiveFileSourceType.buildId,
      },
    ],
  });
  const sourceType = sourceTypeRaw as ArchiveFileSourceType;
  switch (sourceType) {
    case ArchiveFileSourceType.url: {
      const url = await askForArchiveUrlAsync();
      return getArchiveFileLocationAsync({
        ...source,
        sourceType: ArchiveFileSourceType.url,
        url,
      });
    }
    case ArchiveFileSourceType.path: {
      const path = await askForArchivePathAsync(source.platform);
      return getArchiveFileLocationAsync({
        ...source,
        sourceType: ArchiveFileSourceType.path,
        path,
      });
    }
    case ArchiveFileSourceType.latest: {
      return getArchiveFileLocationAsync({
        ...source,
        sourceType: ArchiveFileSourceType.latest,
      });
    }
    case ArchiveFileSourceType.buildId: {
      const id = await askForBuildIdAsync();
      return getArchiveFileLocationAsync({
        ...source,
        sourceType: ArchiveFileSourceType.buildId,
        id,
      });
    }
    case ArchiveFileSourceType.prompt:
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

async function askForArchivePathAsync(platform: SubmissionPlatform): Promise<string> {
  const isIos = platform === SubmissionPlatform.iOS;
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
