import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import {
  CreateRollout,
  NonInteractiveOptions as CreateRolloutNonInteractiveOptions,
} from './CreateRollout';
import {
  EditRollout,
  NonInteractiveOptions as EditRolloutNonInteractiveOptions,
} from './EditRollout';
import { EndRollout, NonInteractiveOptions as EndRolloutNonInteractiveOptions } from './EndRollout';
import { ManageRolloutActions } from './ManageRollout';
import { MainMenuActions, RolloutActions } from './RolloutMainMenu';

/**
 * Control a rollout in non interactive mode.
 */
export class NonInteractiveRollout implements EASUpdateAction<void> {
  constructor(
    private options: {
      channelName?: string;
      action?: RolloutActions;
    } & Partial<EditRolloutNonInteractiveOptions> &
      Partial<EndRolloutNonInteractiveOptions> &
      Partial<CreateRolloutNonInteractiveOptions> = {}
  ) {}

  public async runAsync(ctx: EASUpdateContext): Promise<void> {
    const { channelName, action } = this.options;
    const { nonInteractive, app, graphqlClient } = ctx;
    if (!nonInteractive) {
      throw new Error(`This action is meant for non-interactive mode.`);
    }

    if (!channelName) {
      throw new Error(
        `The channel argument is required in non-interactive mode. Run eas channel:rollout [channel-name]`
      );
    }
    const channelInfo = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: app.projectId,
      channelName,
    });

    if (!action) {
      throw new Error(`--action is required in non-interactive mode.`);
    }
    await this.runActionAsync(ctx, action, channelInfo, this.options);
  }

  async runActionAsync(
    ctx: EASUpdateContext,
    action: RolloutActions,
    channelInfo: UpdateChannelBasicInfoFragment,
    options: Partial<EditRolloutNonInteractiveOptions> &
      Partial<EndRolloutNonInteractiveOptions> &
      Partial<CreateRolloutNonInteractiveOptions>
  ): Promise<UpdateChannelBasicInfoFragment> {
    switch (action) {
      case MainMenuActions.CREATE_NEW:
        return await new CreateRollout(channelInfo, options).runAsync(ctx);
      case ManageRolloutActions.EDIT:
        return await new EditRollout(channelInfo, options).runAsync(ctx);
      case ManageRolloutActions.END:
        return await new EndRollout(channelInfo, options).runAsync(ctx);
    }
  }
}
