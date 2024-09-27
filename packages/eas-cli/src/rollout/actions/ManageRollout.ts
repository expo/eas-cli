import assert from 'assert';
import chalk from 'chalk';

import {
  EditRollout,
  NonInteractiveOptions as EditRolloutNonInteractiveOptions,
} from './EditRollout';
import {
  EndRollout,
  GeneralOptions as EndRolloutGeneralOptions,
  NonInteractiveOptions as EndRolloutNonInteractiveOptions,
} from './EndRollout';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery, UpdateChannelObject } from '../../graphql/queries/ChannelQuery';
import { promptAsync } from '../../prompts';
import { getRolloutInfo, isConstrainedRolloutInfo, isRollout } from '../branch-mapping';
import { printRollout } from '../utils';

export enum ManageRolloutActions {
  EDIT = 'Edit',
  END = 'End',
  VIEW = 'View',
  GO_BACK = 'Go back',
}

/**
 * Manage a rollout for the project.
 */
export class ManageRollout implements EASUpdateAction<EASUpdateAction> {
  constructor(
    private readonly channelInfo: UpdateChannelBasicInfoFragment,
    private readonly options: {
      callingAction?: EASUpdateAction;
      action?: ManageRolloutActions.EDIT | ManageRolloutActions.END | ManageRolloutActions.VIEW;
    } & Partial<EditRolloutNonInteractiveOptions> &
      Partial<EndRolloutNonInteractiveOptions> &
      EndRolloutGeneralOptions
  ) {}

  public async runAsync(ctx: EASUpdateContext): Promise<EASUpdateAction> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      throw new Error(`rollout selection cannot be run in non-interactive mode.`);
    }
    const channelObject = await this.getChannelObjectAsync(ctx);
    printRollout(channelObject);

    const action = this.options.action ?? (await this.selectActionAsync());
    switch (action) {
      case ManageRolloutActions.EDIT:
        return new EditRollout(this.channelInfo, this.options);
      case ManageRolloutActions.END:
        return new EndRollout(this.channelInfo, this.options);
      case ManageRolloutActions.VIEW:
        // Rollout is automatically printed in interactive mode
        return new Noop();
      case ManageRolloutActions.GO_BACK:
        assert(this.options.callingAction, 'calling action must be defined');
        return this.options.callingAction;
    }
  }

  async selectActionAsync(): Promise<ManageRolloutActions> {
    const manageOptions = [ManageRolloutActions.EDIT, ManageRolloutActions.END];
    if (this.options.callingAction) {
      manageOptions.push(ManageRolloutActions.GO_BACK);
    }
    const { manageOption: selectedManageOption } = await promptAsync({
      type: 'select',
      name: 'manageOption',
      message: `What would you like to do?`,
      choices: manageOptions.map(manageOption => ({
        value: manageOption,
        title: manageOption,
      })),
    });
    return selectedManageOption;
  }

  async getChannelObjectAsync(ctx: EASUpdateContext): Promise<UpdateChannelObject> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    if (!isRollout(this.channelInfo)) {
      throw new Error(
        `The channel ${chalk.bold(
          this.channelInfo.name
        )} is not a rollout. To manage a rollout, you must specify a channel with an ongoing rollout.`
      );
    }
    const rolloutInfo = getRolloutInfo(this.channelInfo);
    return await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: this.channelInfo.name,
      ...(isConstrainedRolloutInfo(rolloutInfo)
        ? { filter: { runtimeVersions: [rolloutInfo.runtimeVersion] } }
        : {}),
    });
  }
}

class Noop {
  public async runAsync(): Promise<void> {}
}
