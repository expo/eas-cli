import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
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

export default class ChannelRolloutPreview extends EasCommand {
  static override hidden = true;
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
      relationships: [
        {
          type: 'all',
          flags: [
            {
              name: 'percent',
              // eslint-disable-next-line async-protect/async-suffix
              when: async flags => {
                return (
                  !!flags['non-interactive'] &&
                  (flags['action'] === ActionRawFlagValue.CREATE ||
                    flags['action'] === ActionRawFlagValue.EDIT)
                );
              },
            },
            {
              name: 'outcome',
              // eslint-disable-next-line async-protect/async-suffix
              when: async flags =>
                !!flags['non-interactive'] && flags['action'] === ActionRawFlagValue.END,
            },
            {
              name: 'branch',
              // eslint-disable-next-line async-protect/async-suffix
              when: async flags =>
                !!flags['non-interactive'] && flags['action'] === ActionRawFlagValue.CREATE,
            },
            {
              name: 'runtime-version',
              // eslint-disable-next-line async-protect/async-suffix
              when: async flags =>
                !!flags['non-interactive'] && flags['action'] === ActionRawFlagValue.CREATE,
            },
          ],
        },
      ],
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
    const { args, flags } = await this.parse(ChannelRolloutPreview);
    const argsAndFlags = this.sanitizeArgsAndFlags({ ...flags, ...args });
    const {
      privateProjectConfig: { exp, projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelRolloutPreview, {
      nonInteractive: argsAndFlags.nonInteractive,
    });
    if (argsAndFlags.json) {
      // TODO(quin): implement json output
      throw new Error('Developer Preview doesnt support JSON output yet');
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
      Log.addNewLineIfNone();
      Log.warn(
        `✨ This command is in Developer Preview and has not been released to production yet`
      );
      Log.addNewLineIfNone();
      await new RolloutMainMenu(argsAndFlags).runAsync(ctx);
    }
  }

  private getAction(action: ActionRawFlagValue): RolloutActions {
    switch (action) {
      case ActionRawFlagValue.CREATE:
        return MainMenuActions.CREATE_NEW;
      case ActionRawFlagValue.EDIT:
        return ManageRolloutActions.EDIT;
      case ActionRawFlagValue.END:
        return ManageRolloutActions.END;
    }
  }

  private sanitizeArgsAndFlags(
    rawFlags: ChannelRolloutRawArgsAndFlags
  ): ChannelRolloutArgsAndFlags {
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
