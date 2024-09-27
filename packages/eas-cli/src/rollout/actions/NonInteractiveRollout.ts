import {
  CreateRollout,
  NonInteractiveOptions as CreateRolloutNonInteractiveOptions,
} from './CreateRollout';
import {
  EditRollout,
  NonInteractiveOptions as EditRolloutNonInteractiveOptions,
} from './EditRollout';
import {
  EndRollout,
  GeneralOptions as EndRolloutGeneralOptions,
  NonInteractiveOptions as EndRolloutNonInteractiveOptions,
} from './EndRollout';
import { ManageRolloutActions } from './ManageRollout';
import { MainMenuActions, RolloutActions } from './RolloutMainMenu';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import {
  ChannelQuery,
  UpdateBranchObject,
  UpdateChannelObject,
} from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { printJsonOnlyOutput } from '../../utils/json';
import { getRollout, getRolloutInfo, isConstrainedRolloutInfo, isRollout } from '../branch-mapping';
import { printRollout } from '../utils';

type JSONRolloutOutput = {
  defaultBranch: UpdateBranchObject;
  rolledOutBranch: UpdateBranchObject;
  percentRolledOut: number;
  runtimeVersion?: string;
  updatedAt: Date;
};

type JSONOutput = {
  hasRollout: boolean;
  originalRolloutInfo?: JSONRolloutOutput;
  currentRolloutInfo?: JSONRolloutOutput;
};
/**
 * Control a rollout in non interactive mode.
 */
export class NonInteractiveRollout implements EASUpdateAction<void> {
  constructor(
    private readonly options: {
      channelName?: string;
      json?: boolean;
      action?: RolloutActions;
    } & Partial<EditRolloutNonInteractiveOptions> &
      Partial<EndRolloutNonInteractiveOptions> &
      EndRolloutGeneralOptions &
      Partial<CreateRolloutNonInteractiveOptions>
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
    const channelObject = await this.getChannelObjectAsync(ctx, {
      channelName,
      runtimeVersion: this.getRuntimeVersion(channelInfo),
    });

    if (!action) {
      throw new Error(`--action is required in non-interactive mode.`);
    }
    const updatedChannelInfo = await this.runActionAsync(ctx, action, channelObject);
    const updatedChannelObject = await this.getChannelObjectAsync(ctx, {
      channelName,
      runtimeVersion: this.getRuntimeVersion(updatedChannelInfo),
    });
    if (this.options.json) {
      const json = await this.getJsonAsync({
        originalChannelObject: channelObject,
        updatedChannelObject,
      });
      printJsonOnlyOutput(json);
    }
  }

  async runActionAsync(
    ctx: EASUpdateContext,
    action: RolloutActions,
    channelObject: UpdateChannelObject
  ): Promise<UpdateChannelBasicInfoFragment> {
    switch (action) {
      case MainMenuActions.CREATE_NEW:
        return await new CreateRollout(channelObject, this.options).runAsync(ctx);
      case ManageRolloutActions.EDIT:
        return await new EditRollout(channelObject, this.options).runAsync(ctx);
      case ManageRolloutActions.END:
        return await new EndRollout(channelObject, this.options).runAsync(ctx);
      case ManageRolloutActions.VIEW:
        return this.viewRollout(channelObject);
    }
  }

  viewRollout(channelObject: UpdateChannelObject): UpdateChannelObject {
    if (!this.options.json) {
      printRollout(channelObject);
      Log.warn('For formatted output, add the --json flag to your command.');
    }
    return channelObject;
  }

  async getJsonAsync({
    originalChannelObject,
    updatedChannelObject,
  }: {
    originalChannelObject: UpdateChannelObject;
    updatedChannelObject: UpdateChannelObject;
  }): Promise<JSONOutput> {
    return {
      hasRollout: isRollout(updatedChannelObject),
      ...(isRollout(originalChannelObject)
        ? { originalRolloutInfo: await this.getRolloutJsonAsync(originalChannelObject) }
        : {}),
      ...(isRollout(updatedChannelObject)
        ? { currentRolloutInfo: await this.getRolloutJsonAsync(updatedChannelObject) }
        : {}),
    };
  }

  async getRolloutJsonAsync(channelObject: UpdateChannelObject): Promise<JSONRolloutOutput> {
    const rollout = getRollout(channelObject);
    return {
      defaultBranch: rollout.defaultBranch,
      rolledOutBranch: rollout.rolledOutBranch,
      percentRolledOut: rollout.percentRolledOut,
      runtimeVersion: this.getRuntimeVersion(channelObject) ?? undefined,
      updatedAt: channelObject.updatedAt,
    };
  }

  getRuntimeVersion(channelInfo: UpdateChannelBasicInfoFragment): string | undefined {
    if (isRollout(channelInfo)) {
      const updatedRolloutInfo = getRolloutInfo(channelInfo);
      if (isConstrainedRolloutInfo(updatedRolloutInfo)) {
        return updatedRolloutInfo.runtimeVersion;
      }
    }
    return undefined;
  }

  async getChannelObjectAsync(
    ctx: EASUpdateContext,
    { channelName, runtimeVersion }: { channelName: string; runtimeVersion?: string }
  ): Promise<UpdateChannelObject> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    return await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName,
      ...(runtimeVersion ? { filter: { runtimeVersions: [runtimeVersion] } } : {}),
    });
  }
}
