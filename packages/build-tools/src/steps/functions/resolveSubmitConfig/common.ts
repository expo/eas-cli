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
  buildId: string;
  platform: Platform;
  projectFullName: string;
  projectOwnerAccountName: string;
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
          slug
          ownerAccount {
            id
            name
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
    buildId: build.id,
    platform: AppPlatformToPlatform[build.platform],
    projectFullName: `@${build.app.ownerAccount.name}/${build.app.slug}`,
    projectOwnerAccountName: build.app.ownerAccount.name,
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
