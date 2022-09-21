import { Flags } from '@oclif/core';
import assert from 'assert';

import EasCommand, { EASCommandProjectConfigContext } from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { EasPaginatedQueryFlags, getPaginatedQueryOptions } from '../../commandUtils/pagination';
import {
  listAndRenderAppleDevicesOnAppleTeamAsync,
  selectAppleTeamOnAccountAsync,
} from '../../devices/queries';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput } from '../../utils/json';

export default class BuildList extends EasCommand {
  static override description = 'list all registered devices for your account';

  static override flags = {
    'apple-team-id': Flags.string(),
    ...EasPaginatedQueryFlags,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...EASCommandProjectConfigContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildList);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const {
      projectConfig: { projectId },
    } = await this.getContextAsync(BuildList, {
      nonInteractive: paginatedQueryOptions.nonInteractive,
    });
    let appleTeamIdentifier = flags['apple-team-id'];
    let appleTeamName;
    if (paginatedQueryOptions.json) {
      enableJsonOutput();
    }

    const account = await getOwnerAccountForProjectIdAsync(projectId);

    if (!appleTeamIdentifier) {
      const selectedAppleTeam = await selectAppleTeamOnAccountAsync({
        accountName: account.name,
        paginatedQueryOptions,
        selectionPromptTitle: 'What Apple Team would you like to list devices for?',
      });
      appleTeamIdentifier = selectedAppleTeam.id;
      appleTeamName = selectedAppleTeam.appleTeamName;
    }

    assert(appleTeamIdentifier, 'No team identifier is specified');

    await listAndRenderAppleDevicesOnAppleTeamAsync({
      accountName: account.name,
      appleTeam: {
        appleTeamIdentifier,
        appleTeamName,
      },
      paginatedQueryOptions,
    });
  }
}
