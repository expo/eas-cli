import gql from 'graphql-tag';

export const AppleDistributionCertificateFragmentNode = gql`
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
