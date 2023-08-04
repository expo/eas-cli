import assert from 'assert';

import { SelectChannel } from '../../channel/actions/SelectChannel';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { isRollout } from '../branch-mapping';
import {
  CreateRollout,
  NonInteractiveOptions as CreateRolloutNonInteractiveOptions,
} from './CreateRollout';
import { NonInteractiveOptions as EditRolloutNonInteractiveOptions } from './EditRollout';
import {
  GeneralOptions as EndRolloutGeneralOptions,
  NonInteractiveOptions as EndRolloutNonInteractiveOptions,
} from './EndRollout';
import { ManageRollout, ManageRolloutActions } from './ManageRollout';
import { SelectRollout } from './SelectRollout';

export enum MainMenuActions {
  CREATE_NEW = 'Create a new rollout',
  MANAGE_EXISTING = 'Manage an existing rollout',
}

export type RolloutActions =
  | MainMenuActions.CREATE_NEW
  | ManageRolloutActions.EDIT
  | ManageRolloutActions.END;

/**
 * Manage a rollout for the project.
 */
export class RolloutMainMenu implements EASUpdateAction<void> {
  constructor(
    private options: {
      channelName?: string;
      action?: RolloutActions;
    } & Partial<EditRolloutNonInteractiveOptions> &
      Partial<EndRolloutNonInteractiveOptions> &
      EndRolloutGeneralOptions &
      Partial<CreateRolloutNonInteractiveOptions>
  ) {}

  public async runAsync(ctx: EASUpdateContext): Promise<void> {
    const { action } = this.options;
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      throw new Error(`rollout main menu cannot be run in non-interactive mode.`);
    }
    const menuOption = action ? this.toMainMenuAction(action) : await this.promptMenuActionAsync();
    await this.runActionAsync(ctx, menuOption);
  }

  async runActionAsync(ctx: EASUpdateContext, menuAction: MainMenuActions): Promise<null> {
    const { channelName } = this.options;
    switch (menuAction) {
      case MainMenuActions.CREATE_NEW: {
        const channelInfo = channelName
          ? await this.resolveChannelNameAsync(ctx, channelName)
          : await this.selectChannelAsync(ctx, channelInfo => !isRollout(channelInfo));
        await new CreateRollout(channelInfo, this.options).runAsync(ctx);
        return null;
      }
      case MainMenuActions.MANAGE_EXISTING: {
        const channelInfo = channelName
          ? await this.resolveChannelNameAsync(ctx, channelName)
          : await this.selectRolloutAsync(ctx);
        if (!channelInfo) {
          Log.log('You dont have any rollouts.');
        } else {
          assert(
            this.options.action !== MainMenuActions.CREATE_NEW,
            'Invalid route for create action'
          );
          const manageAction = await new ManageRollout(channelInfo, {
            ...this.options,
            action: this.options.action,
            callingAction: this,
          }).runAsync(ctx);
          await manageAction.runAsync(ctx);
        }
        return null;
      }
    }
  }

  async selectRolloutAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment | null> {
    const selectRollout = new SelectRollout();
    const channelInfo = await selectRollout.runAsync(ctx);
    return channelInfo;
  }

  async selectChannelAsync(
    ctx: EASUpdateContext,
    filterPredicate?: (channelInfo: UpdateChannelBasicInfoFragment) => boolean
  ): Promise<UpdateChannelBasicInfoFragment> {
    const selectChannelAction = new SelectChannel({ filterPredicate });
    const channelInfo = await selectChannelAction.runAsync(ctx);
    if (!channelInfo) {
      throw new Error(`You dont have any channels. Create one with \`eas channel:create\``);
    }
    return channelInfo;
  }

  async resolveChannelNameAsync(
    ctx: EASUpdateContext,
    channelName: string
  ): Promise<UpdateChannelBasicInfoFragment> {
    const { graphqlClient, app } = ctx;
    return await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: app.projectId,
      channelName,
    });
  }

  toMainMenuAction(action: RolloutActions): MainMenuActions {
    if (action === MainMenuActions.CREATE_NEW) {
      return MainMenuActions.CREATE_NEW;
    } else if (action === ManageRolloutActions.EDIT || action === ManageRolloutActions.END) {
      return MainMenuActions.MANAGE_EXISTING;
    } else {
      throw new Error(`Action not supported yet: ` + action);
    }
  }

  async promptMenuActionAsync(): Promise<MainMenuActions> {
    const menuOptions = [MainMenuActions.CREATE_NEW, MainMenuActions.MANAGE_EXISTING];
    const { menuOption: selectedMenuOption } = await promptAsync({
      type: 'select',
      name: 'menuOption',
      message: `What would you like to do?`,
      choices: menuOptions.map(menuOption => ({
        value: menuOption,
        title: menuOption,
      })),
    });
    return selectedMenuOption;
  }
}
