import { AppPlatform, BuildArtifacts, BuildFragment, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

// `BuildFragment` with non-null `artifacts.buildUrl`
type BuildFragmentWithArtifact = Omit<BuildFragment, 'artifacts'> & {
  artifacts: Omit<BuildArtifacts, 'buildUrl'> & BuildArtifacts & { buildUrl: string };
};

/**
 * Gets build by ID and ensures that `artifacts.buildUrl` exists
 */
export async function getBuildByIdForSubmissionAsync(
  platform: AppPlatform,
  buildId: string
): Promise<BuildFragmentWithArtifact> {
  const build = await BuildQuery.byIdAsync(buildId);

  if (build.platform !== platform) {
    throw new Error("Build platform doesn't match!");
  }

  if (!buildFragmentHasArtifact(build)) {
    throw new Error('Build has no artifacts or build URL is not defined.');
  }

  return build;
}

export async function getLatestBuildForSubmissionAsync(
  platform: AppPlatform,
  appId: string
): Promise<BuildFragmentWithArtifact | null> {
  const builds = await BuildQuery.allForAppAsync(appId, {
    platform,
    status: BuildStatus.Finished,
    limit: 1,
  });

  if (builds.length < 1) {
    return null;
  }

  const build = builds[0];
  if (!buildFragmentHasArtifact(build)) {
    return null;
  }

  return build;
}

// Utility function needed to make TypeScript happy
function buildFragmentHasArtifact(build: BuildFragment): build is BuildFragmentWithArtifact {
  return build.artifacts?.buildUrl != null;
}
