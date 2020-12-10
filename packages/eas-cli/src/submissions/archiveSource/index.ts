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
  realFileSource: ArchiveFileSource;
}

export async function getArchiveAsync(
  platform: SubmissionPlatform,
  source: ArchiveSource
): Promise<Archive> {
  const { location, realSource } = await getArchiveFileLocationAsync(source.archiveFile);
  const type = await getArchiveTypeAsync(platform, source.archiveType, location);
  return {
    location,
    type,
    realFileSource: realSource,
  };
}

export { ArchiveFileSource, ArchiveTypeSourceType, ArchiveTypeSource, ArchiveFileSourceType };
