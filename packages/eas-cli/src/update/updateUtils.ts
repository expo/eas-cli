import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../graphql/client';
import { Update, User } from '../graphql/generated';

type TruncatedUpdate = Pick<
  Update,
  'updateGroup' | 'updateMessage' | 'createdAt' | 'runtimeVersion' | 'platform' | 'id'
> & { actor: Pick<User, 'username' | 'firstName'> };

type UpdateGroup = Pick<
  Update,
  'updateGroup' | 'updateMessage' | 'createdAt' | 'runtimeVersion'
> & { platforms: string; actor: Pick<User, 'username' | 'firstName'> };

const PAGE_LIMIT = 10_000;

export async function viewUpdateReleaseAsync({
  appId,
  releaseName,
}: {
  appId: string;
  releaseName: string;
}): Promise<{
  id: string;
  releaseName: string;
  updates: TruncatedUpdate[];
}> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<
        {
          app: {
            byId: {
              updateReleaseByReleaseName: {
                id: string;
                releaseName: string;
                updates: TruncatedUpdate[];
              };
            };
          };
        },
        {
          appId: string;
          releaseName: string;
        }
      >(
        gql`
          query ViewRelease($appId: String!, $releaseName: String!) {
            app {
              byId(appId: $appId) {
                updateReleaseByReleaseName(releaseName: $releaseName) {
                  id
                  releaseName
                  updates(offset: 0, limit: ${PAGE_LIMIT}) {
                    id
                    updateGroup
                    updateMessage
                    createdAt
                    platform
                    runtimeVersion
                    actor {
                      ... on User {
                        username
                      }
                      ... on Robot {
                        firstName
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          appId,
          releaseName,
        }
      )
      .toPromise()
  );

  return data.app.byId.updateReleaseByReleaseName;
}

export async function getUpdatesAsync(options: {
  projectId: string;
  releaseName: string;
  platformFlag?: string;
}): Promise<UpdateGroup[]> {
  const { projectId, releaseName, platformFlag } = options;

  const UpdateRelease = await viewUpdateReleaseAsync({
    appId: projectId,
    releaseName,
  });

  const filteredUpdates = UpdateRelease.updates.filter(update => {
    if (platformFlag === undefined) {
      return update;
    }

    return platformFlag.split(',').includes(update.platform ?? '');
  });

  const updatesByGroup = filteredUpdates.reduce(
    (acc, update) => {
      const { id, platform, ...rest } = update;
      const platforms = [...([acc[update.updateGroup]?.platforms] ?? []), platform]
        .filter(Boolean)
        .sort()
        .join(', ');

      return {
        ...acc,
        [update.updateGroup]: {
          ...rest,
          platforms,
        },
      };
    },
    {} as {
      [i: string]: UpdateGroup;
    }
  );

  return Object.values(updatesByGroup);
}
