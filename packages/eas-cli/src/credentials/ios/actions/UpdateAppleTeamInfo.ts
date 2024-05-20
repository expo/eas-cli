import { Teams } from '@expo/apple-utils';

import { AccountFragment, AppleTeamFragment, AppleTeamType } from '../../../graphql/generated';
import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AppleTeamQuery } from '../api/graphql/queries/AppleTeamQuery';

/* *
 * Update the Apple Team for the app.
 * If the user is logged in, we sync the Team info from the Developer Portal
 * Else we ask the user to choose their Team Type (Company/Organization, Individual, In-House)
 */
export class UpdateAppleTeamInfo {
  constructor(
    private account: AccountFragment,
    private appleTeamIdentifier: string
  ) {}

  public async runAsync(ctx: CredentialsContext): Promise<AppleTeamFragment> {
    const appleTeam = await AppleTeamQuery.getByAppleTeamIdentifierAsync(
      ctx.graphqlClient,
      this.account.id,
      this.appleTeamIdentifier
    );
    const hasAppleTeamInfo = !!appleTeam && !!appleTeam.appleTeamType;
    if (hasAppleTeamInfo) {
      return appleTeam;
    }

    if (!ctx.appStore.authCtx) {
      return await this.promptAndUpdateAppleTeamTypeAsync(ctx);
    }
    const teams = await Teams.getTeamsAsync();
    const team = teams.find(t => t.teamId === this.appleTeamIdentifier);
    if (!team) {
      return await this.promptAndUpdateAppleTeamTypeAsync(ctx);
    }
    const { teamId, type, name } = team;
    const teamType = appStoreTeamTypeToEnum(type);
    return await ctx.ios.createOrUpdateExistingAppleTeamAsync(ctx.graphqlClient, this.account, {
      appleTeamIdentifier: teamId,
      appleTeamName: name,
      appleTeamType: teamType,
    });
  }

  private async promptAndUpdateAppleTeamTypeAsync(
    ctx: CredentialsContext
  ): Promise<AppleTeamFragment> {
    if (ctx.nonInteractive) {
      throw new Error(
        'Unable to get Apple Team information in non-interactive mode. Please re-run with interactive mode.'
      );
    }
    const teamType = await promptForAppleTeamTypeAsync();
    return await ctx.ios.createOrUpdateExistingAppleTeamAsync(ctx.graphqlClient, this.account, {
      appleTeamIdentifier: this.appleTeamIdentifier,
      appleTeamType: teamType,
    });
  }
}

function appStoreTeamTypeToEnum(
  teamType: 'In-House' | 'Company/Organization' | 'Individual' | string
): AppleTeamType | null {
  if (teamType === 'In-House') {
    return AppleTeamType.InHouse;
  } else if (teamType === 'Company/Organization') {
    return AppleTeamType.CompanyOrOrganization;
  } else if (teamType === 'Individual') {
    return AppleTeamType.Individual;
  }
  return null;
}

async function promptForAppleTeamTypeAsync(): Promise<AppleTeamType> {
  const { appleTeamType } = await promptAsync({
    type: 'select',
    message: 'Select your Apple Team Type:',
    name: 'appleTeamType',
    choices: [
      { title: 'Enterprise', value: AppleTeamType.InHouse },
      { title: 'Company/Organization', value: AppleTeamType.CompanyOrOrganization },
      { title: 'Individual', value: AppleTeamType.Individual },
    ],
  });
  return appleTeamType;
}
