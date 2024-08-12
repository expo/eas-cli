import assert from 'assert';
import chalk from 'chalk';

import {
  EditRollout,
  NonInteractiveOptions as EditRolloutNonInteractiveOptions,
} from './EditRollout';
import {
  EndOutcome,
  EndRollout,
  GeneralOptions as EndRolloutGeneralOptions,
  NonInteractiveOptions as EndRolloutNonInteractiveOptions,
} from './EndRollout';
import {
  EndRolloutNew,
  GeneralOptions as EndRolloutNewGeneralOptions,
  NonInteractiveOptions as EndRolloutNewNonInteractiveOptions,
  NewEndOutcome,
} from './EndRolloutNew';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery, UpdateChannelObject } from '../../graphql/queries/ChannelQuery';
import { promptAsync } from '../../prompts';
import { getRolloutInfo, isConstrainedRolloutInfo, isRollout } from '../branch-mapping';
import { printRollout } from '../utils';

export enum ManageRolloutActions {
  EDIT = 'Edit',
  END = 'End',
  END_LEGACY = 'End (Legacy)',
  VIEW = 'View',
  GO_BACK = 'Go back',
}

/**
 * Manage a rollout for the project.
 */
export class ManageRollout implements EASUpdateAction<EASUpdateAction> {
  constructor(
    private channelInfo: UpdateChannelBasicInfoFragment,
    private options: {
      callingAction?: EASUpdateAction;
      action?: ManageRolloutActions.EDIT | ManageRolloutActions.END | ManageRolloutActions.VIEW;
    } & Partial<EditRolloutNonInteractiveOptions> &
      Omit<Partial<EndRolloutNonInteractiveOptions>, 'outcome'> &
      Omit<Partial<EndRolloutNewNonInteractiveOptions>, 'outcome'> &
      EndRolloutGeneralOptions &
      EndRolloutNewGeneralOptions & {
        outcome?: EndOutcome | NewEndOutcome;
      }
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
      case ManageRolloutActions.END_LEGACY: {
        const outcome = this.options.outcome;
        switch (outcome) {
          case EndOutcome.REPUBLISH_AND_REVERT:
          case EndOutcome.REVERT:
          case undefined:
            return new EndRollout(channelObject, { ...this.options, outcome });
          case NewEndOutcome.REVERT_AND_REPUBLISH:
          case NewEndOutcome.ROLL_OUT_AND_REPUBLISH:
            throw new Error(`Invalid outcome for ${action} action: ${outcome}`);
        }
      }
      // linter incorrect detection of completeness and fallthough
      // eslint-disable-next-line no-fallthrough
      case ManageRolloutActions.END: {
        const outcome = this.options.outcome;
        switch (outcome) {
          case EndOutcome.REPUBLISH_AND_REVERT:
          case EndOutcome.REVERT:
            throw new Error(`Invalid outcome for ${action} action: ${outcome}`);
          case NewEndOutcome.REVERT_AND_REPUBLISH:
          case NewEndOutcome.ROLL_OUT_AND_REPUBLISH:
          case undefined:
            return new EndRolloutNew(channelObject, { ...this.options, outcome });
        }
      }
      // linter incorrect detection of completeness and fallthough
      // eslint-disable-next-line no-fallthrough
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
