import * as uuid from 'uuid';

import { AppPlatform } from '../graphql/generated';
import { ArchiveSource, ArchiveSourceType } from './ArchiveSource';
import { SubmissionContext } from './types';

export function resolveArchiveSource<T extends AppPlatform>(
  ctx: SubmissionContext<T>,
  platform: T
): ArchiveSource {
  const { url, path, id, latest } = ctx.archiveFlags;
  const chosenOptions = [url, path, id, latest];
  if (chosenOptions.filter(opt => opt).length > 1) {
    throw new Error(`Pass only one of: --url, --path, --id, --latest`);
  }

  if (url) {
    return {
      sourceType: ArchiveSourceType.url,
      url,
      platform,
      projectId: ctx.projectId,
    };
  } else if (path) {
    return {
      sourceType: ArchiveSourceType.path,
      path,
      platform,
      projectId: ctx.projectId,
    };
  } else if (id) {
    if (!uuid.validate(id)) {
      throw new Error(`${id} is not an ID`);
    }
    return {
      sourceType: ArchiveSourceType.buildId,
      id,
      platform,
      projectId: ctx.projectId,
    };
  } else if (latest) {
    return {
      sourceType: ArchiveSourceType.latest,
      platform,
      projectId: ctx.projectId,
    };
  } else {
    return {
      sourceType: ArchiveSourceType.prompt,
      platform,
      projectId: ctx.projectId,
    };
  }
}
