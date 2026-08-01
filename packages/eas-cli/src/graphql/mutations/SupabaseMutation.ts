import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { BackgroundJobReceiptDataFragment } from '../generated';
import { BackgroundJobReceiptNode } from '../types/BackgroundJobReceipt';
import {
  BeginSupabaseOAuthInput,
  LinkSupabaseProjectInput,
  ProvisionAdditionalSupabaseProjectInput,
  ProvisionSupabaseProjectInput,
  SetSupabaseConnectionOrganizationInput,
  SupabaseConnectionData,
  SupabaseConnectionFragmentNode,
  SupabaseOAuthStartData,
  SupabaseOrganizationData,
  SupabaseProjectData,
  SupabaseProjectFragmentNode,
} from '../types/SupabaseConnection';

export const SupabaseMutation = {
  async beginSupabaseOAuthAsync(
    graphqlClient: ExpoGraphqlClient,
    input: BeginSupabaseOAuthInput
  ): Promise<SupabaseOAuthStartData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          { supabaseConnection: { beginSupabaseOAuth: SupabaseOAuthStartData } },
          { input: BeginSupabaseOAuthInput }
        >(
          gql`
            mutation BeginSupabaseOAuth($input: BeginSupabaseOAuthInput!) {
              supabaseConnection {
                beginSupabaseOAuth(input: $input) {
                  state
                  url
                }
              }
            }
          `,
          { input }
        )
        .toPromise()
    );
    return data.supabaseConnection.beginSupabaseOAuth;
  },

  async setSupabaseConnectionOrganizationAsync(
    graphqlClient: ExpoGraphqlClient,
    input: SetSupabaseConnectionOrganizationInput
  ): Promise<SupabaseConnectionData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          {
            supabaseConnection: { setSupabaseConnectionOrganization: SupabaseConnectionData };
          },
          { input: SetSupabaseConnectionOrganizationInput }
        >(
          gql`
            mutation SetSupabaseConnectionOrganization(
              $input: SetSupabaseConnectionOrganizationInput!
            ) {
              supabaseConnection {
                setSupabaseConnectionOrganization(input: $input) {
                  id
                  ...SupabaseConnectionFragment
                }
              }
            }
            ${print(SupabaseConnectionFragmentNode)}
          `,
          { input },
          { additionalTypenames: ['SupabaseConnection'] }
        )
        .toPromise()
    );
    return data.supabaseConnection.setSupabaseConnectionOrganization;
  },

  async disconnectSupabaseAsync(graphqlClient: ExpoGraphqlClient, id: string): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{ supabaseConnection: { disconnectSupabase: string } }, { id: string }>(
          gql`
            mutation DisconnectSupabase($id: ID!) {
              supabaseConnection {
                disconnectSupabase(id: $id)
              }
            }
          `,
          { id },
          { additionalTypenames: ['Account', 'SupabaseConnection', 'SupabaseProject'] }
        )
        .toPromise()
    );
    return data.supabaseConnection.disconnectSupabase;
  },

  async provisionSupabaseProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    input: ProvisionSupabaseProjectInput
  ): Promise<BackgroundJobReceiptDataFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          { supabaseProject: { provisionSupabaseProject: BackgroundJobReceiptDataFragment } },
          { input: ProvisionSupabaseProjectInput }
        >(
          gql`
            mutation ProvisionSupabaseProject($input: ProvisionSupabaseProjectInput!) {
              supabaseProject {
                provisionSupabaseProject(input: $input) {
                  id
                  ...BackgroundJobReceiptData
                }
              }
            }
            ${print(BackgroundJobReceiptNode)}
          `,
          { input },
          { additionalTypenames: ['App', 'SupabaseProject', 'BackgroundJobReceipt'] }
        )
        .toPromise()
    );
    return data.supabaseProject.provisionSupabaseProject;
  },

  async provisionAdditionalSupabaseProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    input: ProvisionAdditionalSupabaseProjectInput
  ): Promise<BackgroundJobReceiptDataFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          {
            supabaseProject: {
              provisionAdditionalSupabaseProject: BackgroundJobReceiptDataFragment;
            };
          },
          { input: ProvisionAdditionalSupabaseProjectInput }
        >(
          gql`
            mutation ProvisionAdditionalSupabaseProject(
              $input: ProvisionAdditionalSupabaseProjectInput!
            ) {
              supabaseProject {
                provisionAdditionalSupabaseProject(input: $input) {
                  id
                  ...BackgroundJobReceiptData
                }
              }
            }
            ${print(BackgroundJobReceiptNode)}
          `,
          { input },
          { additionalTypenames: ['App', 'SupabaseProject', 'BackgroundJobReceipt'] }
        )
        .toPromise()
    );
    return data.supabaseProject.provisionAdditionalSupabaseProject;
  },

  async linkSupabaseProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    input: LinkSupabaseProjectInput
  ): Promise<SupabaseProjectData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          { supabaseProject: { linkSupabaseProject: SupabaseProjectData } },
          { input: LinkSupabaseProjectInput }
        >(
          gql`
            mutation LinkSupabaseProject($input: LinkSupabaseProjectInput!) {
              supabaseProject {
                linkSupabaseProject(input: $input) {
                  id
                  ...SupabaseProjectFragment
                }
              }
            }
            ${print(SupabaseProjectFragmentNode)}
          `,
          { input },
          { additionalTypenames: ['App', 'SupabaseProject'] }
        )
        .toPromise()
    );
    return data.supabaseProject.linkSupabaseProject;
  },

  async deleteSupabaseProjectAsync(graphqlClient: ExpoGraphqlClient, id: string): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{ supabaseProject: { deleteSupabaseProject: string } }, { id: string }>(
          gql`
            mutation DeleteSupabaseProject($id: ID!) {
              supabaseProject {
                deleteSupabaseProject(id: $id)
              }
            }
          `,
          { id },
          { additionalTypenames: ['App', 'SupabaseProject'] }
        )
        .toPromise()
    );
    return data.supabaseProject.deleteSupabaseProject;
  },

  async listSupabaseOrganizationsAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string
  ): Promise<SupabaseOrganizationData[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          {
            supabaseConnection: {
              listSupabaseOrganizations: SupabaseOrganizationData[];
            };
          },
          { accountId: string }
        >(
          gql`
            mutation ListSupabaseOrganizations($accountId: ID!) {
              supabaseConnection {
                listSupabaseOrganizations(accountId: $accountId) {
                  id
                  slug
                  name
                }
              }
            }
          `,
          { accountId }
        )
        .toPromise()
    );
    return data.supabaseConnection.listSupabaseOrganizations;
  },

  async fetchSupabasePublishableKeyAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<string | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          { supabaseProject: { fetchSupabasePublishableKey: string | null } },
          { appId: string }
        >(
          gql`
            mutation FetchSupabasePublishableKey($appId: ID!) {
              supabaseProject {
                fetchSupabasePublishableKey(appId: $appId)
              }
            }
          `,
          { appId }
        )
        .toPromise()
    );
    return data.supabaseProject.fetchSupabasePublishableKey;
  },
};
