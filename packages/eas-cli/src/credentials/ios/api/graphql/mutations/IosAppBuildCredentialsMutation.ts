import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { IosAppBuildCredentials, IosDistributionType } from '../../../../../graphql/generated';
import { IosAppBuildCredentialsFragment } from '../../../../../graphql/types/credentials/IosAppBuildCredentials';

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
            mutation IosAppBuildCredentialsMutation($iosAppBuildCredentialsInput: IosAppBuildCredentialsInput!, $iosAppCredentialsId: ID!) {
              iosAppBuildCredentials {
                createIosAppBuildCredentials(iosAppBuildCredentialsInput: $iosAppBuildCredentialsInput, iosAppCredentialsId: $iosAppCredentialsId) {
                  ...${IosAppBuildCredentialsFragment.name}
                }
              }
            }
            ${print(IosAppBuildCredentialsFragment.definition)}
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
            mutation IosAppBuildCredentialsMutation($iosAppBuildCredentialsId: ID!, $distributionCertificateId: ID!) {
              iosAppBuildCredentials {
                setDistributionCertificate(id: $iosAppBuildCredentialsId, distributionCertificateId: $distributionCertificateId) {
                  ...${IosAppBuildCredentialsFragment.name}
                }
              }
            }
            ${print(IosAppBuildCredentialsFragment.definition)}
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
            mutation IosAppBuildCredentialsMutation($iosAppBuildCredentialsId: ID!, $provisioningProfileId: ID!) {
              iosAppBuildCredentials {
                setProvisioningProfile(id: $iosAppBuildCredentialsId, provisioningProfileId: $provisioningProfileId) {
                  ...${IosAppBuildCredentialsFragment.name}
                }
              }
            }
            ${print(IosAppBuildCredentialsFragment.definition)}
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
