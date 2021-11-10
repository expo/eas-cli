import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';
import { v4 as uuidv4 } from 'uuid';

import { TrackingContext } from '../analytics/commands/common';
import { Analytics, SubmissionEvent } from '../analytics/commands/events';
import { CredentialsContext } from '../credentials/context';
import { getExpoConfig } from '../project/expoConfig';
import { getProjectAccountName } from '../project/projectUtils';
import { findAccountByName } from '../user/Account';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';

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
  projectId: string;
}): Promise<SubmissionContext<T>> {
  const { projectDir, nonInteractive } = params;
  const exp = getExpoConfig(projectDir, { env: params.env });
  const { env, ...rest } = params;
  const user = await ensureLoggedInAsync();
  const projectName = exp.slug;
  const accountName = getProjectAccountName(exp, user);
  const accountId = findAccountByName(user.accounts, accountName)?.id;
  let credentialsCtx: CredentialsContext | undefined = params.credentialsCtx;
  if (!credentialsCtx) {
    credentialsCtx = new CredentialsContext({ projectDir, user, exp, nonInteractive });
  }

  const trackingCtx = {
    tracking_id: uuidv4(),
    platform: params.platform,
    ...(accountId && { account_id: accountId }),
    account_name: accountName,
    project_id: params.projectId,
  };

  Analytics.logEvent(SubmissionEvent.SUBMIT_COMMAND, trackingCtx);

  return {
    ...rest,
    accountName,
    credentialsCtx,
    exp,
    projectName,
    user,
    trackingCtx,
  };
}
