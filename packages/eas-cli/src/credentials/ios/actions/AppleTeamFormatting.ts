import { AppleTeamFragment } from '../../../graphql/generated';

export function formatAppleTeam({ appleTeamIdentifier, appleTeamName }: AppleTeamFragment): string {
  return `Team ID: ${appleTeamIdentifier}${appleTeamName ? `, Team name: ${appleTeamName}` : ''}`;
}
