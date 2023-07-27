import chalk from 'chalk';

import { UpdateChannelObject } from '../graphql/queries/ChannelQuery';
import Log from '../log';
import formatFields from '../utils/formatFields';
import { getRollout, isConstrainedRollout } from './branch-mapping';

export function printRollout(channel: UpdateChannelObject): void {
  const rollout = getRollout(channel);
  const rolledOutPercent = rollout.percentRolledOut;
  Log.addNewLineIfNone();
  Log.log(chalk.bold('Rollout:'));
  Log.log(
    formatFields([
      { label: 'Channel', value: channel.name },
      ...(isConstrainedRollout(rollout)
        ? [{ label: 'Runtime Version', value: rollout.runtimeVersion }]
        : []),
      {
        label: 'Branches',
        value: `${rollout.rolledOutBranch.name} (${rolledOutPercent}%), ${
          rollout.defaultBranch.name
        } (${100 - rolledOutPercent}%)`,
      },
    ])
  );
  Log.addNewLineIfNone();
}

export function printBranch(channel: UpdateChannelObject): void {
  const rollout = getRollout(channel);
  const rolledOutPercent = rollout.percentRolledOut;
  Log.addNewLineIfNone();
  Log.log(chalk.bold('Rollout:'));
  Log.log(
    formatFields([
      { label: 'Channel', value: channel.name },
      ...(isConstrainedRollout(rollout)
        ? [{ label: 'Runtime Version', value: rollout.runtimeVersion }]
        : []),
      {
        label: 'Branches',
        value: `${rollout.rolledOutBranch.name} (${rolledOutPercent}%), ${
          rollout.defaultBranch.name
        } (${100 - rolledOutPercent}%)`,
      },
    ])
  );
  Log.addNewLineIfNone();
}
