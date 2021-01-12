import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { IosAppBuildCredentials, IosDistributionType } from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';

const IosAppBuildCredentialsMutation = {
  async createIosAppBuildCredentialsAsync(
    iosAppBuildCredentialsInput: {
      iosDistributionType: IosDistributionType;
      distributionCertificateId: string;
      provisioningProfileId: string;
    },
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
    iosAppBuildCredentialsId: string,
    provisioningProfileId: string
  ): Promise<IosAppBuildCredentials> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          iosAppBuildCredentials: { setProvisioningProfile: IosAppBuildCredentials };
        }>(
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
    return data.iosAppBuildCredentials.setProvisioningProfile;
  },
};

export { IosAppBuildCredentialsMutation };
