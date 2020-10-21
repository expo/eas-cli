import gql from 'graphql-tag';

import { graphqlClient } from '../../graphql/client';
import { Build } from '../types/Build';

type Filters = Partial<Pick<Build, 'platform' | 'status'>> & {
  order?: number;
  limit?: number;
};

type ArtifactFragmentType = Pick<Build, 'artifacts'>;
type PlatformAndArtifactFragmentType = Pick<Build, 'platform' | 'artifacts'>;

export class BuildQuery {
  static async forArtifactByIdAsync(buildId: string): Promise<PlatformAndArtifactFragmentType> {
    const { data, error } = await graphqlClient
      .query<{ builds: { byId: PlatformAndArtifactFragmentType } }>(
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

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Returned data is empty!');
    }

    return data.builds.byId;
  }

  static async allArtifactsForAppAsync(
    appId: string,
    filters?: Filters
  ): Promise<ArtifactFragmentType[]> {
    const filterData = [`appId: "${appId}"`];

    if (filters?.limit) {
      filterData.push(`limit: ${filters.limit}`);
    }

    if (filters?.order) {
      filterData.push(`order: ${filters.order}`);
    }

    if (filters?.platform) {
      filterData.push(`platform: ${filters.platform}`);
    }

    if (filters?.status) {
      filterData.push(`status: ${filters.status}`);
    }

    const { data, error } = await graphqlClient
      .query<{ builds: { allForApp: ArtifactFragmentType[] } }>(
        gql`
    {
      builds {
        allForApp(${filterData.join(', ')}) {
          artifacts {
            buildUrl
          }
        }
      }
    }`
      )
      .toPromise();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Returned data is empty!');
    }

    return data.builds.allForApp;
  }
}
