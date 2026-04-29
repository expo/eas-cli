import { Platform, SubmissionConfig, UserError } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils, SubmitProfile } from '@expo/eas-json';
import { graphql } from 'gql.tada';

import { CustomBuildContext } from '../../../customBuildContext';

export type AppPlatform = 'ANDROID' | 'IOS';

export const AppPlatformToPlatform: Record<AppPlatform, Platform> = {
  ANDROID: Platform.ANDROID,
  IOS: Platform.IOS,
};

export type BuildInfo = {
  appIdentifier?: string | null;
  appId: string;
  buildId: string;
  projectOwnerAccountId: string;
  platform: Platform;
};

export type ResolvedSubmitConfig = {
  appIdentifier?: string;
  config: SubmissionConfig.Android | SubmissionConfig.Ios;
  platform: Platform;
};

const BUILD_BY_ID_QUERY = graphql(`
  query ResolveSubmitConfigBuildById($buildId: ID!) {
    builds {
      byId(buildId: $buildId) {
        id
        platform
        appIdentifier
        app {
          id
          ownerAccount {
            id
          }
        }
      }
    }
  }
`);

export async function getBuildInfoAsync(
  ctx: CustomBuildContext,
  buildId: string
): Promise<BuildInfo> {
  const result = await ctx.graphqlClient.query(BUILD_BY_ID_QUERY, { buildId }).toPromise();
  if (result.error) {
    throw result.error;
  }
  const build = result.data?.builds.byId;
  if (!build) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_BUILD_NOT_FOUND',
      `Could not find build ${buildId}.`
    );
  }
  return {
    appIdentifier: build.appIdentifier,
    appId: build.app.id,
    buildId: build.id,
    projectOwnerAccountId: build.app.ownerAccount.id,
    platform: AppPlatformToPlatform[build.platform],
  };
}

export async function getSubmitProfileAsync<T extends Platform>({
  platform,
  profileName,
  workingDirectory,
}: {
  platform: T;
  profileName: string;
  workingDirectory: string;
}): Promise<SubmitProfile<T>> {
  return await EasJsonUtils.getSubmitProfileAsync(
    EasJsonAccessor.fromProjectPath(workingDirectory),
    platform,
    profileName
  );
}
