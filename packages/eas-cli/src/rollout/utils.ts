import chalk from 'chalk';

import { Rollout, getRollout, isConstrainedRollout, isRollout } from './branch-mapping';
import {
  RuntimeFragment,
  UpdateBranchBasicInfoFragment,
  UpdateFragment,
} from '../graphql/generated';
import { UpdateBranchObject, UpdateChannelObject } from '../graphql/queries/ChannelQuery';
import Log from '../log';
import { promptAsync } from '../prompts';
import { FormattedUpdateGroupDescription, getUpdateGroupDescriptions } from '../update/utils';
import formatFields from '../utils/formatFields';

export function printRollout(channel: UpdateChannelObject): void {
  if (!isRollout(channel)) {
    Log.log(`Channel ${chalk.bold(channel.name)} doesn't have a rollout.`);
    return;
  }
  const rollout = getRollout(channel);
  displayRolloutDetails(channel.name, rollout);
}

export function displayRolloutDetails(
  channelName: string,
  rollout: Rollout<UpdateBranchBasicInfoFragment>
): void {
  const rolledOutPercent = rollout.percentRolledOut;
  Log.newLine();
  Log.log(chalk.bold('🚀 Rollout:'));
  Log.log(
    formatFields([
      { label: 'Channel', value: channelName },
      ...(isConstrainedRollout(rollout)
        ? [{ label: 'Runtime version', value: rollout.runtimeVersion }]
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

export function formatBranchWithUpdateGroup(
  maybeUpdateGroup: UpdateFragment[] | undefined | null,
  branch: UpdateBranchObject,
  percentRolledOut: number
): string {
  const lines: string[] = [];
  lines.push(
    chalk.bold(
      `➡️ 📱 Latest update on the ${chalk.bold(branch.name)} branch (${percentRolledOut}%)`
    )
  );
  if (!maybeUpdateGroup) {
    lines.push(`No updates for target runtime`);
  } else {
    const [updateGroupDescription] = getUpdateGroupDescriptions([maybeUpdateGroup]);
    lines.push(...formatUpdateGroup(updateGroupDescription));
  }
  return lines.join('\n    ');
}

export function formatRuntimeWithUpdateGroup(
  maybeUpdateGroup: UpdateFragment[] | undefined | null,
  runtime: RuntimeFragment,
  branchName: string
): string {
  const lines: string[] = [];
  lines.push(
    chalk.bold(
      `➡️ 📱 Latest update on the ${chalk.bold(branchName)} branch served to runtime ${chalk.bold(
        runtime.version
      )}:`
    )
  );
  if (!maybeUpdateGroup) {
    lines.push(`No updates published for this runtime`);
  } else {
    const [updateGroupDescription] = getUpdateGroupDescriptions([maybeUpdateGroup]);
    lines.push(...formatUpdateGroup(updateGroupDescription));
  }
  return lines.join('\n    ');
}

function formatUpdateGroup(updateGroup: FormattedUpdateGroupDescription): string[] {
  const lines: string[] = [];
  const formattedLines = formatFields([
    { label: 'Message', value: updateGroup.message ?? 'N/A' },
    { label: 'Runtime version', value: updateGroup.runtimeVersion ?? 'N/A' },
    { label: 'Platforms', value: updateGroup.platforms ?? 'N/A' },
    { label: 'Group ID', value: updateGroup.group ?? 'N/A' },
  ]).split('\n');
  lines.push(...formattedLines);
  return lines;
}

export async function promptForRolloutPercentAsync({
  promptMessage,
}: {
  promptMessage: string;
}): Promise<number> {
  const { name: rolloutPercent } = await promptAsync({
    type: 'text',
    name: 'name',
    format: value => {
      return parseInt(value, 10);
    },
    message: promptMessage,
    initial: 0,
    validate: (rolloutPercent: string): true | string => {
      const floatValue = parseFloat(rolloutPercent);
      return Number.isInteger(floatValue) && floatValue >= 0 && floatValue <= 100
        ? true
        : 'The rollout percentage must be an integer between 0 and 100 inclusive.';
    },
  });
  return rolloutPercent;
}
