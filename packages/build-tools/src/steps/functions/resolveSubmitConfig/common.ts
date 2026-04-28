import { Platform, SubmissionConfig } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils, SubmitProfile } from '@expo/eas-json';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import { graphql } from 'gql.tada';

import { downloadBuildAsync } from '../downloadBuild';
import { CustomBuildContext } from '../../../customBuildContext';

export type AppPlatform = 'ANDROID' | 'IOS';

export type BuildInfo = {
  appIdentifier?: string | null;
  appPlatform: AppPlatform;
  buildId: string;
  buildProfile?: string | null;
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
        buildProfile
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
    throw new Error(`Could not find build ${buildId}.`);
  }
  return {
    appIdentifier: build.appIdentifier,
    appPlatform: build.platform,
    buildId: build.id,
    buildProfile: build.buildProfile,
    projectFullName: `@${build.app.ownerAccount.name}/${build.app.slug}`,
    projectOwnerAccountName: build.app.ownerAccount.name,
  };
}

export async function getSubmitProfileAsync<T extends Platform>({
  env,
  platform,
  profileName,
  workingDirectory,
}: {
  env: BuildStepEnv;
  platform: T;
  profileName?: string;
  workingDirectory: string;
}): Promise<SubmitProfile<T>> {
  return await withEnvAsync(env, async () =>
    EasJsonUtils.getSubmitProfileAsync(
      EasJsonAccessor.fromProjectPath(workingDirectory),
      platform,
      profileName
    )
  );
}

export async function resolveArtifactPathAsync({
  artifactPath,
  build,
  ctx,
  logger,
  platform,
}: {
  artifactPath?: string;
  build: BuildInfo;
  ctx: CustomBuildContext;
  logger: bunyan;
  platform: Platform;
}): Promise<string | undefined> {
  if (artifactPath || build.appIdentifier) {
    return artifactPath;
  }

  const { artifactPath: downloadedArtifactPath } = await downloadBuildAsync({
    buildId: build.buildId,
    extensions: platform === Platform.ANDROID ? ['apk', 'aab'] : ['ipa'],
    expoApiServerURL: ctx.env.__API_SERVER_URL,
    logger,
    robotAccessToken: ctx.job.secrets?.robotAccessToken ?? null,
  });
  return downloadedArtifactPath;
}

export function appPlatformToPlatform(platform: AppPlatform): Platform {
  return platform === 'ANDROID' ? Platform.ANDROID : Platform.IOS;
}

async function withEnvAsync<T>(env: BuildStepEnv, fn: () => Promise<T>): Promise<T> {
  const originalEnv = process.env;
  try {
    process.env = { ...process.env, ...env };
    return await fn();
  } finally {
    process.env = originalEnv;
  }
}
