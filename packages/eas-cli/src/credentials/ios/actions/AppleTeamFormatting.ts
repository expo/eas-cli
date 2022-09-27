import { AppleTeamFragment } from '../../../graphql/generated';

export function formatAppleTeam({
  appleTeamIdentifier,
  appleTeamName,
}: Pick<AppleTeamFragment, 'appleTeamIdentifier' | 'appleTeamName'>): string {
  return `Team ID: ${appleTeamIdentifier}${appleTeamName ? `, Team name: ${appleTeamName}` : ''}`;
}
