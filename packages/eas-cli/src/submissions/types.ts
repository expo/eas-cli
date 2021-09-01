import { AndroidSubmitProfile, IosSubmitProfile } from '@expo/eas-json';

import { AppPlatform } from '../graphql/generated';

export interface SubmissionContext<T extends AppPlatform> {
  archiveFlags: SubmitArchiveFlags;
  platform: T;
  profile: T extends AppPlatform.Android ? AndroidSubmitProfile : IosSubmitProfile;
  projectDir: string;
  projectId: string;
}

export interface SubmitArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}
