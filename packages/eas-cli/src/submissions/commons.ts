import { getConfig } from '@expo/config';
import * as uuid from 'uuid';

import { ensureProjectExistsAsync } from '../project/ensureProjectExists';
import { getProjectAccountNameAsync } from '../project/projectUtils';
import { ArchiveFileSource, ArchiveFileSourceType } from './archive-source';
import { AndroidSubmissionContext, IosSubmissionContext, SubmissionPlatform } from './types';

export async function getProjectIdAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  return await ensureProjectExistsAsync({
    accountName: await getProjectAccountNameAsync(projectDir),
    projectName: exp.slug,
  });
}

export function resolveArchiveFileSource(
  ctx: AndroidSubmissionContext | IosSubmissionContext,
  projectId: string
): ArchiveFileSource {
  const { url, path, id, latest } = ctx.commandFlags;
  const chosenOptions = [url, path, id, latest];
  if (chosenOptions.filter(opt => opt).length > 1) {
    throw new Error(`Pass only one of: --url, --path, --id, --latest`);
  }

  if (url) {
    return {
      sourceType: ArchiveFileSourceType.url,
      url,
      projectId,
      platform: SubmissionPlatform.iOS,
      projectDir: ctx.projectDir,
    };
  } else if (path) {
    return {
      sourceType: ArchiveFileSourceType.path,
      path,
      projectId,
      platform: SubmissionPlatform.iOS,
      projectDir: ctx.projectDir,
    };
  } else if (id) {
    if (!uuid.validate(id)) {
      throw new Error(`${id} is not an ID`);
    }
    return {
      sourceType: ArchiveFileSourceType.buildId,
      id,
      projectId,
      platform: SubmissionPlatform.iOS,
      projectDir: ctx.projectDir,
    };
  } else if (latest) {
    return {
      sourceType: ArchiveFileSourceType.latest,
      platform: SubmissionPlatform.iOS,
      projectDir: ctx.projectDir,
      projectId,
    };
  } else {
    return {
      sourceType: ArchiveFileSourceType.prompt,
      platform: SubmissionPlatform.iOS,
      projectDir: ctx.projectDir,
      projectId,
    };
  }
}
