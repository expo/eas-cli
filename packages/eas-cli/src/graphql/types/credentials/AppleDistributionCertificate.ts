import gql from 'graphql-tag';

export const AppleDistributionCertificateFragmentDoc = gql`
  fragment AppleDistributionCertificateFragment on AppleDistributionCertificate {
    id
    certificateP12
    certificatePassword
    serialNumber
    developerPortalIdentifier
    validityNotBefore
    validityNotAfter
    appleTeam {
      id
      appleTeamIdentifier
      appleTeamName
    }
  }
`;
