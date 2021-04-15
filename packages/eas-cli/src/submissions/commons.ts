import * as uuid from 'uuid';

import { AppPlatform } from '../graphql/generated';
import { ArchiveFileSource, ArchiveFileSourceType } from './archiveSource';
import { AndroidSubmissionContext, IosSubmissionContext } from './types';

export function resolveArchiveFileSource(
  platform: AppPlatform,
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
      platform,
      projectDir: ctx.projectDir,
    };
  } else if (path) {
    return {
      sourceType: ArchiveFileSourceType.path,
      path,
      projectId,
      platform,
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
      platform,
      projectDir: ctx.projectDir,
    };
  } else if (latest) {
    return {
      sourceType: ArchiveFileSourceType.latest,
      platform,
      projectDir: ctx.projectDir,
      projectId,
    };
  } else {
    return {
      sourceType: ArchiveFileSourceType.prompt,
      platform,
      projectDir: ctx.projectDir,
      projectId,
    };
  }
}
