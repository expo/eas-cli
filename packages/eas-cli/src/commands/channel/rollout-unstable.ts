import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { NonInteractiveOptions as CreateRolloutNonInteractiveOptions } from '../../rollout/actions/CreateRollout';
import { NonInteractiveOptions as EditRolloutNonInteractiveOptions } from '../../rollout/actions/EditRollout';
import {
  EndOutcome,
  NonInteractiveOptions as EndRolloutNonInteractiveOptions,
} from '../../rollout/actions/EndRollout';
import { ManageRolloutActions } from '../../rollout/actions/ManageRollout';
import { NonInteractiveRollout } from '../../rollout/actions/NonInteractiveRollout';
import {
  MainMenuActions,
  RolloutActions,
  RolloutMainMenu,
} from '../../rollout/actions/RolloutMainMenu';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { confirmAsync } from '../../prompts';

enum ActionRawFlagValue {
  CREATE = 'create',
  EDIT = 'edit',
  END = 'end',
}
type ChannelRolloutRawArgsAndFlags = {
  channel?: string;
  action?: ActionRawFlagValue;
  percent?: number;
  outcome?: EndOutcome;
  'non-interactive': boolean;
  branch?: string;
  'runtime-version'?: string;
  json?: boolean;
};

type ChannelRolloutArgsAndFlags = {
  channelName?: string;
  action?: RolloutActions;
  nonInteractive: boolean;
  json?: boolean;
} & Partial<EditRolloutNonInteractiveOptions> &
  Partial<EndRolloutNonInteractiveOptions> &
  Partial<CreateRolloutNonInteractiveOptions>;

export default class ChannelRolloutUnstable extends EasCommand {
  static override description = 'Roll a new branch out on a channel incrementally.';

  static override args = [
    {
      name: 'channel',
      description: 'channel on which the rollout should be done',
    },
  ];

  static override flags = {
    action: Flags.enum({
      description: 'Rollout action to perform',
      options: Object.values(ActionRawFlagValue),
      required: false,
    }),
    percent: Flags.integer({
      description:
        'Percent of users to send to the new branch. Use with --action=edit or --action=create',
      required: false,
    }),
    outcome: Flags.enum({
      description: 'End outcome of rollout. Use with --action=end',
      options: Object.values(EndOutcome),
      required: false,
    }),
    branch: Flags.string({
      description: 'Branch to rollout. Use with --action=create',
      required: false,
    }),
    'runtime-version': Flags.string({
      description: 'Runtime version to target. Use with --action=create',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(ChannelRolloutUnstable);
    const argsAndFlags = this.sanitizeArgsAndFlags({ ...flags, ...args });
    const {
      privateProjectConfig: { exp, projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelRolloutUnstable, {
      nonInteractive: argsAndFlags.nonInteractive,
    });
    if (argsAndFlags.json) {
      // TODO(quin): implement json output
      throw new Error('json support not implemented');
    }

    const app = { projectId, exp };
    const ctx = {
      projectId,
      nonInteractive: argsAndFlags.nonInteractive,
      graphqlClient,
      app,
    };
    if (argsAndFlags.nonInteractive) {
      await new NonInteractiveRollout(argsAndFlags).runAsync(ctx);
    } else {
      const didConfirm = await confirmAsync({
        message: `🚨 This command is unstable and not suitable for production. OK?`,
      });
      if (!didConfirm) {
        throw new Error('Aborted');
      }
      await new RolloutMainMenu(argsAndFlags).runAsync(ctx);
    }
  }

  getAction(action: ActionRawFlagValue): RolloutActions {
    switch (action) {
      case ActionRawFlagValue.CREATE:
        return MainMenuActions.CREATE_NEW;
      case ActionRawFlagValue.EDIT:
        return ManageRolloutActions.EDIT;
      case ActionRawFlagValue.END:
        return ManageRolloutActions.END;
    }
  }

  sanitizeArgsAndFlags(rawFlags: ChannelRolloutRawArgsAndFlags): ChannelRolloutArgsAndFlags {
    const action = rawFlags.action;
    return {
      channelName: rawFlags.channel,
      percent: rawFlags.percent,
      outcome: rawFlags.outcome,
      branchNameToRollout: rawFlags.branch,
      runtimeVersion: rawFlags['runtime-version'],
      action: action ? this.getAction(action) : undefined,
      nonInteractive: rawFlags['non-interactive'],
      json: rawFlags.json,
    };
  }
}
