import { Platform } from '@expo/eas-build-job';

import { ArchiveSource, ArchiveSourceType, isUuidV4 } from './ArchiveSource';
import { SubmissionContext } from './context';

export function resolveArchiveSource<T extends Platform>(ctx: SubmissionContext<T>): ArchiveSource {
  const { url, path, id, latest } = ctx.archiveFlags;
  const chosenOptions = [url, path, id, latest];
  if (chosenOptions.filter(opt => opt).length > 1) {
    throw new Error(`Pass only one of: --url, --path, --id, --latest`);
  }

  if (url) {
    return {
      sourceType: ArchiveSourceType.url,
      url,
    };
  } else if (path) {
    return {
      sourceType: ArchiveSourceType.path,
      path,
    };
  } else if (id) {
    if (!isUuidV4(id)) {
      throw new Error(`${id} is not a valid ID`);
    }
    return {
      sourceType: ArchiveSourceType.buildId,
      id,
    };
  } else if (latest) {
    return {
      sourceType: ArchiveSourceType.latest,
    };
  } else if (ctx.nonInteractive) {
    throw new Error('You need to specify the archive source when running in non-interactive mode ');
  } else {
    return {
      sourceType: ArchiveSourceType.prompt,
    };
  }
}
