import { Platform } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';

export interface SubmissionContext<T extends Platform> {
  archiveFlags: SubmitArchiveFlags;
  platform: T;
  profile: SubmitProfile<T>;
  projectDir: string;
  projectId: string;
}

export interface SubmitArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}
