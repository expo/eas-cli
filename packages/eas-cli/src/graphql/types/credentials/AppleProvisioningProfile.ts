import gql from 'graphql-tag';

export const AppleProvisioningProfileFragmentDoc = gql`
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
