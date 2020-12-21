import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../graphql/client';
import { Update, User } from '../graphql/generated';

type TruncatedUpdate = Pick<
  Update,
  'updateGroup' | 'updateMessage' | 'createdAt' | 'platform' | 'runtimeVersion' | 'id'
> & { platforms: string; actor: User };

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
      .mutation<
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

export async function getUpdates(options: {
  projectId: string;
  releaseName: string;
  platformFlag: string;
  allFlag: boolean;
}) {
  const { projectId, releaseName, platformFlag, allFlag } = options;

  const UpdateRelease = await viewUpdateReleaseAsync({
    appId: projectId,
    releaseName,
  });

  const filteredUpdates = UpdateRelease.updates.filter(update => {
    if (!platformFlag) {
      return update;
    }

    return platformFlag.split(',').includes(update.platform);
  });

  if (allFlag) {
    return filteredUpdates;
  }

  const updatesByGroup = filteredUpdates.reduce(
    (acc, update) => ({
      ...acc,
      [update.updateGroup]: {
        ...update,
        platforms: [acc[update.updateGroup]?.platform, update.platform]
          .filter(Boolean)
          .sort()
          .join(', '),
      },
    }),
    {} as {
      [i: string]: TruncatedUpdate;
    }
  );

  return Object.values(updatesByGroup);
}
