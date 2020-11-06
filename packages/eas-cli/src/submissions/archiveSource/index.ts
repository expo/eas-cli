import { ArchiveType, SubmissionPlatform } from '../types';
import {
  ArchiveFileSource,
  ArchiveFileSourceType,
  getArchiveFileLocationAsync,
} from './ArchiveFileSource';
import { ArchiveTypeSource, ArchiveTypeSourceType, getArchiveTypeAsync } from './ArchiveTypeSource';

export interface ArchiveSource {
  archiveFile: ArchiveFileSource;
  archiveType: ArchiveTypeSource;
}

export interface Archive {
  location: string;
  type: ArchiveType;
}

export async function getArchiveAsync(
  platform: SubmissionPlatform,
  source: ArchiveSource
): Promise<Archive> {
  const location = await getArchiveFileLocationAsync(source.archiveFile);
  const type = await getArchiveTypeAsync(platform, source.archiveType, location);
  return {
    location,
    type,
  };
}

export { ArchiveFileSource, ArchiveTypeSourceType, ArchiveTypeSource, ArchiveFileSourceType };
