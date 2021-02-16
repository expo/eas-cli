import gql from 'graphql-tag';

export const AppleProvisioningProfileFragmentNode = gql`
  fragment AppleProvisioningProfileFragment on AppleProvisioningProfile {
    id
    expiration
    developerPortalIdentifier
    provisioningProfile
    appleTeam {
      id
      appleTeamIdentifier
      appleTeamName
    }
    appleDevices {
      id
      identifier
      name
      model
      deviceClass
    }
  }
`;
export const AppleProvisioningProfileIdentifiersFragmentNode = gql`
  fragment AppleProvisioningProfileIdentifiersFragment on AppleProvisioningProfile {
    id
    developerPortalIdentifier
  }
`;
