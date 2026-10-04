import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  GitHubRepositoryAppQuery,
  GitHubRepositoryAppQueryVariables,
  GitHubRepositoryInstallationsQuery,
  GitHubRepositoryInstallationsQueryVariables,
  GitHubRepositoryPageQuery,
  GitHubRepositoryPageQueryVariables,
} from '../generated';

// The default github.com registration also represents legacy installations with no registration.
const DEFAULT_GITHUB_APP_REGISTRATION_ID = '00000000-0000-0000-0000-000000000000';

export const GitHubRepositoryQuery = {
  async getAppAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<GitHubRepositoryAppQuery['app']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GitHubRepositoryAppQuery, GitHubRepositoryAppQueryVariables>(
          gql`
            query GitHubRepositoryApp($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  fullName
                  ownerAccount {
                    id
                    name
                  }
                  githubRepository {
                    id
                    githubRepositoryIdentifier
                    metadata {
                      id
                      githubRepoOwnerName
                      githubRepoName
                      githubRepoUrl
                    }
                  }
                  githubRepositorySettings {
                    id
                    baseDirectory
                  }
                }
              }
            }
          `,
          { appId },
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
    return data.app.byId;
  },

  async getAccountInstallationsAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<
    NonNullable<GitHubRepositoryInstallationsQuery['account']['byName']>['githubAppInstallations']
  > {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GitHubRepositoryInstallationsQuery, GitHubRepositoryInstallationsQueryVariables>(
          gql`
            query GitHubRepositoryInstallations($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  githubAppInstallations {
                    id
                    installationIdentifier
                    metadata {
                      githubAccountName
                      installationStatus
                    }
                    registration {
                      id
                      origin
                    }
                  }
                }
              }
            }
          `,
          { accountName },
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
    return data.account.byName?.githubAppInstallations ?? [];
  },

  async findRepositoryAsync(
    graphqlClient: ExpoGraphqlClient,
    installationIdentifier: number,
    fullName: string
  ): Promise<
    | GitHubRepositoryPageQuery['githubAppRegistrations']['byId']['repositoriesForViewer']['edges'][number]['node']
    | null
  > {
    let after: string | undefined;
    do {
      const data = await withErrorHandlingAsync(
        graphqlClient
          .query<GitHubRepositoryPageQuery, GitHubRepositoryPageQueryVariables>(
            gql`
              query GitHubRepositoryPage($registrationId: ID!, $installationIdentifier: Int!, $after: String) {
                githubAppRegistrations {
                  byId(githubAppRegistrationId: $registrationId) {
                    id
                    repositoriesForViewer(
                      installationIdentifier: $installationIdentifier
                      first: 100
                      after: $after
                    ) {
                      edges {
                        node {
                          id
                          nodeId
                          name
                          owner {
                            login
                          }
                        }
                      }
                      pageInfo {
                        hasNextPage
                        endCursor
                      }
                    }
                  }
                }
              }
            `,
            { registrationId: DEFAULT_GITHUB_APP_REGISTRATION_ID, installationIdentifier, after },
            { requestPolicy: 'network-only' }
          )
          .toPromise()
      );
      const { edges, pageInfo } = data.githubAppRegistrations.byId.repositoriesForViewer;
      const repository = edges.find(
        ({ node }) => `${node.owner.login}/${node.name}`.toLowerCase() === fullName.toLowerCase()
      )?.node;
      if (repository) {
        return repository;
      }
      if (!pageInfo.hasNextPage) {
        return null;
      }
      if (!pageInfo.endCursor || pageInfo.endCursor === after) {
        throw new Error('Could not read the next page of GitHub repositories. Try again.');
      }
      after = pageInfo.endCursor;
    } while (after);
    return null;
  },
};
