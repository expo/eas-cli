import { Teams } from '@expo/apple-utils';

import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';

export class ChooseAssociatedAppleTeamId {
  constructor(private associatedCredential: string) {}

  public async runAsync(ctx: CredentialsContext): Promise<string> {
    if (!ctx.appStore.authCtx) {
      return await this.promptForAppleTeamIdAsync();
    }

    const teams = await Teams.getTeamsAsync();
    const chosenTeamId = await this.promptForAppleTeamIdFromDeveloperPortalAsync(
      teams.map(team => ({ prettyName: `${team.name} (${team.type})`, teamId: team.teamId }))
    );
    return chosenTeamId ?? (await this.promptForAppleTeamIdAsync());
  }

  private async promptForAppleTeamIdFromDeveloperPortalAsync(
    teamChoices: { prettyName: string; teamId: string }[]
  ): Promise<string | null> {
    if (teamChoices.length === 0) {
      return null;
    }
    const { appleTeamId } = await promptAsync({
      type: 'select',
      message: `Select the Apple Team associated with your ${this.associatedCredential}:`,
      name: 'appleTeamId',
      choices: [
        ...teamChoices.map(({ prettyName, teamId }) => ({ title: prettyName, value: teamId })),
        { title: 'None of the above', value: null },
      ],
    });
    return appleTeamId;
  }

  private async promptForAppleTeamIdAsync(): Promise<string> {
    const { appleTeamId } = await promptAsync({
      type: 'text',
      name: 'appleTeamId',
      message: `Input the Apple Team ID associated with your ${this.associatedCredential}:`,
      validate: (val: string) => val !== '',
    });
    return appleTeamId;
  }
}
