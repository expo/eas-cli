import gql from 'graphql-tag';

import { graphqlClient } from '../../api';
import { SubmissionPlatform } from '../types';

const graphqlPlatform: Record<SubmissionPlatform, string> = {
  [SubmissionPlatform.Android]: 'ANDROID',
  [SubmissionPlatform.iOS]: 'IOS',
};

export async function getBuildArtifactUrlByIdAsync(
  platform: SubmissionPlatform,
  buildId: string
): Promise<string> {
  const { data, error } = await graphqlClient
    .query(
      gql`
    {
      builds {
        byId(buildId: "${buildId}") {
          platform,
          artifacts {
            buildUrl
          }
        }
      }
    }`
    )
    .toPromise();

  if (error?.graphQLErrors) {
    throw error.graphQLErrors[0];
  }

  const {
    platform: buildPlatform,
    artifacts: { buildUrl },
  } = data.builds.byId;

  if (buildPlatform !== graphqlPlatform[platform]) {
    throw new Error("Build platform doesn't match!");
  }

  return buildUrl;
}

export async function getLatestBuildArtifactUrlAsync(
  platform: SubmissionPlatform,
  appId: string
): Promise<string> {
  const { data, error } = await graphqlClient
    .query(
      gql`
    {
      builds {
        allForApp(
          appId: "${appId}",
          platform: ${graphqlPlatform[platform]},
          status: FINISHED,
          limit: 1
        ) {
          artifacts {
            buildUrl
          }
        }
      }
    }`
    )
    .toPromise();

  if (error?.graphQLErrors) {
    throw error.graphQLErrors[0];
  }

  if (data.builds.allForApp.length !== 1) {
    throw new Error(`No builds were found for platform: ${platform}`);
  }

  return data.builds.allForApp[0].artifacts.buildUrl;
}
