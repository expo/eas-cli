import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';

import { getExpoConfig } from '../project/expoConfig';

export interface SubmissionContext<T extends Platform> {
  archiveFlags: SubmitArchiveFlags;
  platform: T;
  profile: SubmitProfile<T>;
  projectDir: string;
  projectId: string;
  nonInteractive: boolean;
  exp: ExpoConfig;
}

export interface SubmitArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}

export function createSubmissionContext<T extends Platform>(params: {
  platform: T;
  archiveFlags: SubmitArchiveFlags;
  profile: SubmitProfile<T>;
  projectDir: string;
  projectId: string;
  nonInteractive: boolean;
  env?: Record<string, string>;
}): SubmissionContext<T> {
  const { projectDir } = params;
  const exp = getExpoConfig(projectDir, { env: params.env });
  const { env, ...rest } = params;
  return {
    ...rest,
    exp,
  };
}
