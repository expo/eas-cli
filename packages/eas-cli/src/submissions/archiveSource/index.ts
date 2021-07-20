import { AppPlatform } from '../../graphql/generated';
import { ArchiveType } from '../types';
import { SubmittedBuildInfo } from '../utils/builds';
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
  submittedBuildDetails?: SubmittedBuildInfo;
}

export async function getArchiveAsync(
  platform: AppPlatform,
  source: ArchiveSource
): Promise<Archive> {
  const { location, realSource, buildDetails } = await getArchiveFileLocationAsync(
    source.archiveFile
  );
  const type = await getArchiveTypeAsync(platform, source.archiveType, location);
  return {
    location,
    type,
    realFileSource: realSource,
    submittedBuildDetails: buildDetails,
  };
}

export { ArchiveFileSource, ArchiveTypeSourceType, ArchiveTypeSource, ArchiveFileSourceType };
