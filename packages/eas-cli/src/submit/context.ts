import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';
import { v4 as uuidv4 } from 'uuid';

import { TrackingContext } from '../analytics/common';
import { Analytics, SubmissionEvent } from '../analytics/events';
import { CredentialsContext } from '../credentials/context';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { Actor } from '../user/User';

export interface SubmissionContext<T extends Platform> {
  accountName: string;
  archiveFlags: SubmitArchiveFlags;
  credentialsCtx: CredentialsContext;
  trackingCtx: TrackingContext;
  exp: ExpoConfig;
  nonInteractive: boolean;
  platform: T;
  profile: SubmitProfile<T>;
  projectDir: string;
  projectId: string;
  projectName: string;
  user: Actor;
  applicationIdentifierOverride?: string;
}

export interface SubmitArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}

export async function createSubmissionContextAsync<T extends Platform>(params: {
  archiveFlags: SubmitArchiveFlags;
  credentialsCtx?: CredentialsContext;
  env?: Record<string, string>;
  nonInteractive: boolean;
  platform: T;
  profile: SubmitProfile<T>;
  projectDir: string;
  applicationIdentifier?: string;
  actor: Actor;
  exp: ExpoConfig;
  projectId: string;
}): Promise<SubmissionContext<T>> {
  const { applicationIdentifier, projectDir, nonInteractive, actor, exp, projectId } = params;
  const { env, ...rest } = params;
  const projectName = exp.slug;
  const account = await getOwnerAccountForProjectIdAsync(projectId);
  const accountId = account.id;
  let credentialsCtx: CredentialsContext | undefined = params.credentialsCtx;
  if (!credentialsCtx) {
    credentialsCtx = new CredentialsContext({
      projectDir,
      user: actor,
      projectInfo: { exp, projectId },
      nonInteractive,
    });
  }

  const trackingCtx = {
    tracking_id: uuidv4(),
    platform: params.platform,
    ...(accountId && { account_id: accountId }),
    project_id: projectId,
  };

  Analytics.logEvent(SubmissionEvent.SUBMIT_COMMAND, trackingCtx);

  return {
    ...rest,
    accountName: account.name,
    credentialsCtx,
    projectName,
    user: actor,
    trackingCtx,
    applicationIdentifierOverride: applicationIdentifier,
  };
}
