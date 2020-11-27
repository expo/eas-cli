import { AppleDistributionCertificate, AppleTeam } from '../../../../graphql/generated';

export function formatDistributionCertificate({
  developerPortalIdentifier,
  serialNumber,
  appleTeam,
  validityNotBefore,
  validityNotAfter,
}: AppleDistributionCertificate): string {
  let line: string = '';
  if (developerPortalIdentifier) {
    line += `Cert ID: ${developerPortalIdentifier}`;
  }
  line += `${line === '' ? '' : ', '}Serial number: ${serialNumber}${
    appleTeam ? `, ${formatAppleTeam(appleTeam)}` : ''
  }, Created: ${validityNotBefore}, Expires: ${validityNotAfter}`;
  return line;
}

function formatAppleTeam({ appleTeamIdentifier, appleTeamName }: AppleTeam): string {
  return `Team ID: ${appleTeamIdentifier}${appleTeamName ? `, Team name: ${appleTeamName}` : ''}`;
}
