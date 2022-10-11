import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  IosAppBuildCredentials,
  IosAppBuildCredentialsFragment,
  IosAppBuildCredentialsInput,
  SetProvisioningProfileMutation,
} from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';

export const IosAppBuildCredentialsMutation = {
  async createIosAppBuildCredentialsAsync(
    graphqlClient: ExpoGraphqlClient,
    iosAppBuildCredentialsInput: IosAppBuildCredentialsInput,
    iosAppCredentialsId: string
  ): Promise<IosAppBuildCredentials> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          iosAppBuildCredentials: { createIosAppBuildCredentials: IosAppBuildCredentials };
        }>(
          gql`
            mutation CreateIosAppBuildCredentialsMutation(
              $iosAppBuildCredentialsInput: IosAppBuildCredentialsInput!
              $iosAppCredentialsId: ID!
            ) {
              iosAppBuildCredentials {
                createIosAppBuildCredentials(
                  iosAppBuildCredentialsInput: $iosAppBuildCredentialsInput
                  iosAppCredentialsId: $iosAppCredentialsId
                ) {
                  id
                  ...IosAppBuildCredentialsFragment
                }
              }
            }
            ${print(IosAppBuildCredentialsFragmentNode)}
          `,
          {
            iosAppBuildCredentialsInput,
            iosAppCredentialsId,
          }
        )
        .toPromise()
    );
    return data.iosAppBuildCredentials.createIosAppBuildCredentials;
  },
  async setDistributionCertificateAsync(
    graphqlClient: ExpoGraphqlClient,
    iosAppBuildCredentialsId: string,
    distributionCertificateId: string
  ): Promise<IosAppBuildCredentials> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          iosAppBuildCredentials: { setDistributionCertificate: IosAppBuildCredentials };
        }>(
          gql`
            mutation SetDistributionCertificateMutation(
              $iosAppBuildCredentialsId: ID!
              $distributionCertificateId: ID!
            ) {
              iosAppBuildCredentials {
                setDistributionCertificate(
                  id: $iosAppBuildCredentialsId
                  distributionCertificateId: $distributionCertificateId
                ) {
                  id
                  ...IosAppBuildCredentialsFragment
                }
              }
            }
            ${print(IosAppBuildCredentialsFragmentNode)}
          `,
          {
            iosAppBuildCredentialsId,
            distributionCertificateId,
          }
        )
        .toPromise()
    );
    return data.iosAppBuildCredentials.setDistributionCertificate;
  },
  async setProvisioningProfileAsync(
    graphqlClient: ExpoGraphqlClient,
    iosAppBuildCredentialsId: string,
    provisioningProfileId: string
  ): Promise<IosAppBuildCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetProvisioningProfileMutation>(
          gql`
            mutation SetProvisioningProfileMutation(
              $iosAppBuildCredentialsId: ID!
              $provisioningProfileId: ID!
            ) {
              iosAppBuildCredentials {
                setProvisioningProfile(
                  id: $iosAppBuildCredentialsId
                  provisioningProfileId: $provisioningProfileId
                ) {
                  id
                  ...IosAppBuildCredentialsFragment
                }
              }
            }
            ${print(IosAppBuildCredentialsFragmentNode)}
          `,
          {
            iosAppBuildCredentialsId,
            provisioningProfileId,
          }
        )
        .toPromise()
    );
    assert(
      data.iosAppBuildCredentials.setProvisioningProfile,
      'GraphQL: `setProvisioningProfile` not defined in server response'
    );
    return data.iosAppBuildCredentials.setProvisioningProfile;
  },
};
