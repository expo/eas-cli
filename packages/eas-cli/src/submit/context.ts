import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';
import { v4 as uuidv4 } from 'uuid';

import {
  Analytics,
  AnalyticsEventProperties,
  SubmissionEvent,
} from '../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CredentialsContext } from '../credentials/context';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { Actor } from '../user/User';
import { Client } from '../vcs/vcs';

export interface SubmissionContext<T extends Platform> {
  accountName: string;
  archiveFlags: SubmitArchiveFlags;
  credentialsCtx: CredentialsContext;
  analyticsEventProperties: AnalyticsEventProperties;
  exp: ExpoConfig;
  nonInteractive: boolean;
  isVerboseFastlaneEnabled: boolean;
  platform: T;
  profile: SubmitProfile<T>;
  projectDir: string;
  projectId: string;
  projectName: string;
  user: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  vcsClient: Client;
  applicationIdentifierOverride?: string;
  specifiedProfile?: string;
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
  isVerboseFastlaneEnabled: boolean;
  platform: T;
  profile: SubmitProfile<T>;
  projectDir: string;
  applicationIdentifier?: string;
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  exp: ExpoConfig;
  projectId: string;
  vcsClient: Client;
  specifiedProfile?: string;
}): Promise<SubmissionContext<T>> {
  const {
    applicationIdentifier,
    projectDir,
    nonInteractive,
    actor,
    exp,
    projectId,
    graphqlClient,
    analytics,
    vcsClient,
  } = params;
  const { env, ...rest } = params;
  const projectName = exp.slug;
  const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
  const accountId = account.id;
  let credentialsCtx: CredentialsContext | undefined = params.credentialsCtx;
  if (!credentialsCtx) {
    credentialsCtx = new CredentialsContext({
      projectDir,
      user: actor,
      graphqlClient,
      analytics,
      projectInfo: { exp, projectId },
      nonInteractive,
      vcsClient,
    });
  }

  const analyticsEventProperties = {
    tracking_id: uuidv4(),
    platform: params.platform,
    ...(accountId && { account_id: accountId }),
    project_id: projectId,
  };

  rest.analytics.logEvent(SubmissionEvent.SUBMIT_COMMAND, analyticsEventProperties);

  return {
    ...rest,
    accountName: account.name,
    credentialsCtx,
    projectName,
    user: actor,
    analyticsEventProperties,
    applicationIdentifierOverride: applicationIdentifier,
  };
}
