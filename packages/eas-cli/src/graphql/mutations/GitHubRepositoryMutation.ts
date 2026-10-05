import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateGitHubRepositoryInput,
  CreateGitHubRepositoryMutation,
  CreateGitHubRepositoryMutationVariables,
  CreateGitHubRepositorySettingsInput,
  CreateGitHubRepositorySettingsMutation,
  CreateGitHubRepositorySettingsMutationVariables,
  UpdateGitHubRepositorySettingsMutation,
  UpdateGitHubRepositorySettingsMutationVariables,
} from '../generated';

export const GitHubRepositoryMutation = {
  async createAsync(
    graphqlClient: ExpoGraphqlClient,
    githubRepositoryData: CreateGitHubRepositoryInput
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateGitHubRepositoryMutation, CreateGitHubRepositoryMutationVariables>(
          gql`
            mutation CreateGitHubRepository($githubRepositoryData: CreateGitHubRepositoryInput!) {
              githubRepository {
                createGitHubRepository(githubRepositoryData: $githubRepositoryData) {
                  id
                }
              }
            }
          `,
          { githubRepositoryData },
          { noRetry: true }
        )
        .toPromise()
    );
  },

  async createSettingsAsync(
    graphqlClient: ExpoGraphqlClient,
    githubRepositorySettingsData: CreateGitHubRepositorySettingsInput
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          CreateGitHubRepositorySettingsMutation,
          CreateGitHubRepositorySettingsMutationVariables
        >(
          gql`
            mutation CreateGitHubRepositorySettings(
              $githubRepositorySettingsData: CreateGitHubRepositorySettingsInput!
            ) {
              githubRepositorySettings {
                createGitHubRepositorySettings(githubRepositorySettingsData: $githubRepositorySettingsData) {
                  id
                }
              }
            }
          `,
          { githubRepositorySettingsData },
          { noRetry: true }
        )
        .toPromise()
    );
  },

  async updateSettingsAsync(
    graphqlClient: ExpoGraphqlClient,
    githubRepositorySettingsId: string,
    baseDirectory: string
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          UpdateGitHubRepositorySettingsMutation,
          UpdateGitHubRepositorySettingsMutationVariables
        >(
          gql`
            mutation UpdateGitHubRepositorySettings(
              $githubRepositorySettingsId: ID!
              $githubRepositorySettingsData: UpdateGitHubRepositorySettingsInput!
            ) {
              githubRepositorySettings {
                updateGitHubRepositorySettings(
                  githubRepositorySettingsId: $githubRepositorySettingsId
                  githubRepositorySettingsData: $githubRepositorySettingsData
                ) {
                  id
                }
              }
            }
          `,
          { githubRepositorySettingsId, githubRepositorySettingsData: { baseDirectory } },
          { noRetry: true }
        )
        .toPromise()
    );
  },
};
