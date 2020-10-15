import gql from 'graphql-tag';

import { graphqlClient } from '../../api';
import { SubmissionPlatform } from '../types';

const graphqlPlatform: Record<string, SubmissionPlatform> = {
  ANDROID: SubmissionPlatform.Android,
  IOS: SubmissionPlatform.iOS,
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

  if (graphqlPlatform[buildPlatform as string] !== platform) {
    throw new Error("Build platform doesn't match!");
  }

  return buildUrl;
}

export async function getLatestBuildArtifactUrlAsync(
  platform: SubmissionPlatform,
  appId: string
): Promise<string> {
  throw new Error('Not implemented!');
}
