import { AppleTeamFragment } from '../../../../graphql/generated';
import { AppleDistributionCertificateQueryResult } from '../../api/graphql/queries/AppleDistributionCertificateQuery';

export function formatDistributionCertificate({
  developerPortalIdentifier,
  serialNumber,
  appleTeam,
  validityNotBefore,
  validityNotAfter,
}: AppleDistributionCertificateQueryResult): string {
  let line: string = '';
  if (developerPortalIdentifier) {
    line += `Cert ID: ${developerPortalIdentifier}`;
  }
  line += `${line === '' ? '' : ', '}Serial number: ${serialNumber}${
    appleTeam ? `, ${formatAppleTeam(appleTeam)}` : ''
  }, Created: ${validityNotBefore}, Expires: ${validityNotAfter}`;
  return line;
}

function formatAppleTeam({ appleTeamIdentifier, appleTeamName }: AppleTeamFragment): string {
  return `Team ID: ${appleTeamIdentifier}${appleTeamName ? `, Team name: ${appleTeamName}` : ''}`;
}
