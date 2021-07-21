import { AppPlatform, BuildFragment } from '../../graphql/generated';
import { ArchiveType } from '../types';
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
  build?: BuildFragment;
}

export async function getArchiveAsync(
  platform: AppPlatform,
  source: ArchiveSource
): Promise<Archive> {
  const { location, realSource, build } = await getArchiveFileLocationAsync(source.archiveFile);
  const type = await getArchiveTypeAsync(platform, source.archiveType, location);
  return {
    location,
    type,
    realFileSource: realSource,
    build,
  };
}

export { ArchiveFileSource, ArchiveTypeSourceType, ArchiveTypeSource, ArchiveFileSourceType };
