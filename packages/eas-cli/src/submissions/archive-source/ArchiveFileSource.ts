import chalk from 'chalk';
import validator from 'validator';

import log from '../../log';
import { promptAsync } from '../../prompts';
import { SubmissionPlatform } from '../types';
import { getBuildArtifactUrlByIdAsync, getLatestBuildArtifactUrlAsync } from '../utils/builds';
import {
  downloadAppArchiveAsync,
  extractLocalArchiveAsync,
  isExistingFile,
  pathIsTar,
  uploadAppArchiveAsync,
} from '../utils/files';

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
  projectDir: string;
}

export type ArchiveFileSource =
  | ArchiveFileUrlSource
  | ArchiveFileLatestSource
  | ArchiveFilePathSource
  | ArchiveFileBuildIdSource
  | ArchiveFilePromptSource;

export async function getArchiveFileLocationAsync(source: ArchiveFileSource): Promise<string> {
  switch (source.sourceType) {
    case ArchiveFileSourceType.prompt:
      return await handlePromptSourceAsync(source);
    case ArchiveFileSourceType.url: {
      const url = await handleUrlSourceAsync(source);
      return await getArchiveLocationForUrlAsync(url);
    }
    case ArchiveFileSourceType.latest: {
      const url = await handleLatestSourceAsync(source);
      return await getArchiveLocationForUrlAsync(url);
    }
    case ArchiveFileSourceType.path: {
      const path = await handlePathSourceAsync(source);
      return getArchiveLocationForPathAsync(path);
    }
    case ArchiveFileSourceType.buildId: {
      const url = await handleBuildIdSourceAsync(source);
      return await getArchiveLocationForUrlAsync(url);
    }
  }
}

async function getArchiveLocationForUrlAsync(url: string): Promise<string> {
  // When a URL points to a tar file, download it and extract using unified logic.
  // Otherwise send it directly to the server in online mode.
  if (!pathIsTar(url)) {
    return url;
  } else {
    log('Downloading your app archive');
    const localPath = await downloadAppArchiveAsync(url);
    return await getArchiveLocationForPathAsync(localPath);
  }
}

async function getArchiveLocationForPathAsync(path: string): Promise<string> {
  const resolvedPath = await extractLocalArchiveAsync(path);

  log('Uploading your app archive to the Expo Submission Service');
  return await uploadAppArchiveAsync(resolvedPath);
}

async function handleUrlSourceAsync(source: ArchiveFileUrlSource): Promise<string> {
  return source.url;
}

async function handleLatestSourceAsync(source: ArchiveFileLatestSource): Promise<string> {
  try {
    const artifactUrl = await getLatestBuildArtifactUrlAsync(source.platform, source.projectId);

    if (!artifactUrl) {
      log.error(
        chalk.bold(
          "Couldn't find any builds for this project on Expo servers. It looks like you haven't run eas build yet."
        )
      );
      return getArchiveFileLocationAsync({
        ...source,
        sourceType: ArchiveFileSourceType.prompt,
      });
    }

    return artifactUrl;
  } catch (err) {
    log.error(err);
    throw err;
  }
}

async function handlePathSourceAsync(source: ArchiveFilePathSource): Promise<string> {
  if (!(await isExistingFile(source.path))) {
    log.error(chalk.bold(`${source.path} doesn't exist`));
    return getArchiveFileLocationAsync({
      ...source,
      sourceType: ArchiveFileSourceType.prompt,
    });
  }
  return source.path;
}

async function handleBuildIdSourceAsync(source: ArchiveFileBuildIdSource): Promise<string> {
  try {
    return await getBuildArtifactUrlByIdAsync(source.platform, source.id);
  } catch (err) {
    log.error(chalk.bold(`Couldn't find build for id ${source.id}`));
    log.error(err);
    return getArchiveFileLocationAsync({
      ...source,
      sourceType: ArchiveFileSourceType.prompt,
    });
  }
}

async function handlePromptSourceAsync(source: ArchiveFilePromptSource): Promise<string> {
  const { sourceType: sourceTypeRaw } = await promptAsync({
    name: 'sourceType',
    type: 'select',
    message: 'What would you like to submit?',
    choices: [
      { title: 'I have a url to the app archive', value: ArchiveFileSourceType.url },
      {
        title: "I'd like to upload the app archive from my computer",
        value: ArchiveFileSourceType.path,
      },
      {
        title: 'The latest build from Expo servers',
        value: ArchiveFileSourceType.latest,
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
      const path = await askForArchivePathAsync();
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

async function askForArchivePathAsync(): Promise<string> {
  const defaultArchivePath = '/path/to/your/archive.aab';
  const { path } = await promptAsync({
    name: 'path',
    message: 'Path to the app archive file (aab or apk):',
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
      if (!validator.isUUID(val)) {
        return `${val} is not a valid id`;
      } else {
        return true;
      }
    },
  });
  return id;
}

function validateUrl(url: string): boolean {
  return validator.isURL(url, {
    protocols: ['http', 'https'],
  });
}
