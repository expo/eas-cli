import { Platform } from '@expo/eas-build-job';

import { ArchiveSource, ArchiveSourceType, isUuidV4 } from './ArchiveSource';
import { SubmissionContext } from './context';

export function resolveArchiveSource<T extends Platform>(
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
      nonInteractive: ctx.nonInteractive,
    };
  } else if (path) {
    return {
      sourceType: ArchiveSourceType.path,
      path,
      platform,
      projectId: ctx.projectId,
      nonInteractive: ctx.nonInteractive,
    };
  } else if (id) {
    if (!isUuidV4(id)) {
      throw new Error(`${id} is not a valid ID`);
    }
    return {
      sourceType: ArchiveSourceType.buildId,
      id,
      platform,
      projectId: ctx.projectId,
      nonInteractive: ctx.nonInteractive,
    };
  } else if (latest) {
    return {
      sourceType: ArchiveSourceType.latest,
      platform,
      projectId: ctx.projectId,
      nonInteractive: ctx.nonInteractive,
    };
  } else if (ctx.nonInteractive) {
    throw new Error('You need to specify the archive source when running in non-interactive mode ');
  } else {
    return {
      sourceType: ArchiveSourceType.prompt,
      platform,
      projectId: ctx.projectId,
      nonInteractive: ctx.nonInteractive,
    };
  }
}
