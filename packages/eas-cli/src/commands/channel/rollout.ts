import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { selectBranchOnAppAsync } from '../../branch/queries';
import { selectChannelOnAppAsync } from '../../channel/queries';
import { BranchMapping, getBranchMapping } from '../../channel/utils';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { UpdateBranch } from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import { ChannelQuery, UpdateChannelByNameObject } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync, selectAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { updateChannelBranchMappingAsync } from './edit';

async function promptForRolloutPercentAsync({
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

function getRolloutInfo(channel: UpdateChannelByNameObject): {
  newBranch: Pick<UpdateBranch, 'name' | 'id'>;
  oldBranch: Pick<UpdateBranch, 'name' | 'id'>;
  currentPercent: number;
} {
  const { branchMapping } = getBranchMapping(channel.branchMapping);
  const [newBranchId, oldBranchId] = branchMapping.data.map(d => d.branchId);
  const newBranch = channel.updateBranches.filter(branch => branch.id === newBranchId)[0];
  const oldBranch = channel.updateBranches.filter(branch => branch.id === oldBranchId)[0];

  if (!newBranch || !oldBranch) {
    throw new Error(`Branch mapping rollout is missing a branch for channel "${channel.name}".`);
  }

  const currentPercent = 100 * branchMapping.data[0].branchMappingLogic.operand;
  return { newBranch, oldBranch, currentPercent };
}

async function startRolloutAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    channelName,
    branchName,
    percent,
    projectId,
    displayName,
    currentBranchMapping,
    channel,
    nonInteractive,
  }: {
    channelName?: string;
    branchName: string;
    percent?: number;
    projectId: string;
    displayName: string;
    currentBranchMapping: BranchMapping;
    channel: UpdateChannelByNameObject;
    nonInteractive: boolean;
  }
): Promise<{
  newChannelInfo: {
    id: string;
    name: string;
    branchMapping: string;
  };
  logMessage: string;
}> {
  const branch = await BranchQuery.getBranchByNameAsync(graphqlClient, {
    appId: projectId,
    name: branchName,
  });

  const oldBranchId = currentBranchMapping.data[0].branchId;
  if (branch.id === oldBranchId) {
    throw new Error(
      `channel "${channelName}" is already pointing at branch "${branchName}". Rollouts must be done with distinct branches.`
    );
  }

  if (percent == null) {
    if (nonInteractive) {
      throw new Error(
        'You must specify a percent with the --percent flag when initiating a rollout with the --non-interactive flag.'
      );
    }
    const promptMessage = `What percent of users should be directed to the branch "${branchName}"?`;
    percent = await promptForRolloutPercentAsync({ promptMessage });
  }

  const newBranchMapping = {
    version: 0,
    data: [
      {
        branchId: branch.id,
        branchMappingLogic: {
          operand: percent / 100,
          clientKey: 'rolloutToken',
          branchMappingOperator: 'hash_lt',
        },
      },
      currentBranchMapping.data[0],
    ],
  };
  const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
    channelId: channel.id,
    branchMapping: JSON.stringify(newBranchMapping),
  });

  const oldBranch = channel.updateBranches.filter(branch => branch.id === oldBranchId)[0];
  if (!oldBranch) {
    throw new Error(
      `Branch mapping is missing its only branch for channel "${channelName}" on app "${displayName}"`
    );
  }

  const logMessage = `Started a rollout of branch ${chalk.bold(branchName)} on channel ${chalk.bold(
    channelName!
  )}! ${chalk.bold(percent)}% of users will be directed to branch ${chalk.bold(
    branchName
  )}, ${chalk.bold(100 - percent)}% to branch ${chalk.bold(oldBranch.name)}.`;

  return { newChannelInfo, logMessage };
}

async function editRolloutAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    channelName,
    percent,
    nonInteractive,
    currentBranchMapping,
    channel,
  }: {
    channelName?: string;
    percent?: number;
    nonInteractive: boolean;
    currentBranchMapping: BranchMapping;
    channel: UpdateChannelByNameObject;
  }
): Promise<{
  newChannelInfo: {
    id: string;
    name: string;
    branchMapping: string;
  };
  logMessage: string;
}> {
  const { newBranch, oldBranch, currentPercent } = getRolloutInfo(channel);

  if (percent == null) {
    if (nonInteractive) {
      throw new Error(
        'A rollout is already in progress. If you wish to modify it you must use specify the new rollout percentage with the --percent flag.'
      );
    }
    const promptMessage = `Currently ${currentPercent}% of all users are routed to branch ${
      newBranch.name
    } and ${100 - currentPercent}% of all users are routed to branch ${
      oldBranch.name
    }. What percent of users should be directed to the branch ${newBranch.name}?`;
    percent = await promptForRolloutPercentAsync({ promptMessage });
  }

  const newBranchMapping = { ...currentBranchMapping };
  newBranchMapping.data[0].branchMappingLogic.operand = percent / 100;

  const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
    channelId: channel.id,
    branchMapping: JSON.stringify(newBranchMapping),
  });

  const logMessage = `Rollout of branch ${chalk.bold(newBranch.name)} on channel ${chalk.bold(
    channelName!
  )} updated from ${chalk.bold(currentPercent)}% to ${chalk.bold(percent)}%. ${chalk.bold(
    percent
  )}% of users will be directed to branch ${chalk.bold(newBranch.name)}, ${chalk.bold(
    100 - percent
  )}% to branch ${chalk.bold(oldBranch.name)}.`;

  return { newChannelInfo, logMessage };
}

async function endRolloutAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    channelName,
    branchName,
    nonInteractive,
    projectId,
    channel,
  }: {
    channelName?: string;
    branchName?: string;
    nonInteractive: boolean;
    projectId: string;
    channel: UpdateChannelByNameObject;
  }
): Promise<{
  newChannelInfo: {
    id: string;
    name: string;
    branchMapping: string;
  };
  logMessage: string;
}> {
  // end rollout
  const { newBranch, oldBranch, currentPercent } = getRolloutInfo(channel);

  let endOnNewBranch;
  if (branchName) {
    const branch = await BranchQuery.getBranchByNameAsync(graphqlClient, {
      appId: projectId,
      name: branchName,
    });

    switch (branch.id) {
      case newBranch.id:
        endOnNewBranch = true;
        break;
      case oldBranch.id:
        endOnNewBranch = false;
        break;
      default:
        throw new Error(
          `The branch "${branchName}" specified by --branch must be one of the branches involved in the rollout: "${newBranch.name}" or "${oldBranch.name}".`
        );
    }
  } else {
    if (nonInteractive) {
      throw new Error(
        'Branch name must be specified with the --branch flag when both the --end and --non-interactive flag are true.'
      );
    }
    endOnNewBranch = await selectAsync<boolean>(
      'Ending the rollout will send all traffic to a single branch. Which one should that be?',
      [
        {
          title: `${newBranch.name} ${chalk.grey(`- current percent: ${currentPercent}%`)}`,
          value: true,
        },
        {
          title: `${oldBranch.name} ${chalk.grey(`- current percent: ${100 - currentPercent}%`)}`,
          value: false,
        },
      ]
    );
  }
  if (endOnNewBranch == null) {
    throw new Error('Branch to end on is undefined.');
  }

  const newBranchMapping = {
    version: 0,
    data: [
      {
        branchId: endOnNewBranch ? newBranch.id : oldBranch.id,
        branchMappingLogic: 'true',
      },
    ],
  };

  const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
    channelId: channel.id,
    branchMapping: JSON.stringify(newBranchMapping),
  });
  const logMessage = `Rollout on channel ${chalk.bold(
    channelName
  )} ended. All traffic is now sent to branch ${chalk.bold(
    endOnNewBranch ? newBranch.name : oldBranch.name
  )}`;

  return { newChannelInfo, logMessage };
}

export default class ChannelRollout extends EasCommand {
  static override description = 'Roll a new branch out on a channel incrementally.';

  static override args = [
    {
      name: 'channel',
      description: 'channel on which the rollout should be done',
    },
  ];

  static override flags = {
    branch: Flags.string({
      description: 'branch to rollout',
      required: false,
    }),
    percent: Flags.integer({
      description: 'percent of users to send to the new branch',
      required: false,
    }),
    end: Flags.boolean({
      description: 'end the rollout',
      default: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { channel: channelNameArg },
      flags: {
        json: jsonFlag,
        end: endFlag,
        branch: branchName,
        percent,
        'non-interactive': nonInteractive,
      },
    } = await this.parse(ChannelRollout);
    const {
      projectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelRollout, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    let channelName: string = channelNameArg;
    if (!channelName) {
      const { name } = await selectChannelOnAppAsync(graphqlClient, {
        projectId,
        selectionPromptTitle: 'Select a channel on which to perform a rollout',
        paginatedQueryOptions: {
          json: jsonFlag,
          nonInteractive,
          offset: 0,
        },
      });
      channelName = name;
    }

    const channel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName,
    });
    if (!channel) {
      throw new Error(
        `Could not find a channel named "${channelName}". Check which channels exist on this project with ${chalk.bold(
          'eas channel:list'
        )}.`
      );
    }

    const { branchMapping: currentBranchMapping, isRollout } = getBranchMapping(
      channel.branchMapping
    );

    if (currentBranchMapping.data.length === 0) {
      throw new Error('The channel is not pointing at any branches.');
    }
    if (currentBranchMapping.data.length > 2) {
      throw new Error('"channel:rollout" cannot handle branch mappings with more than 2 branches.');
    }
    // This combination doesn't make sense. Throw an error explaining the options.
    if (isRollout && branchName && !endFlag) {
      throw new Error(
        `There is a rollout in progress. You can only either edit the rollout percent or 'end' it.`
      );
    }

    /**
     * This if/else block has three branches:
     *  1. The branch mapping is not a rollout, i.e. it is pointing to a single branch.
     *  2. The branch mapping is a rollout.
     *    a. increase/decrease the rollout percentage.
     *    b. end the rollout.
     */
    let rolloutMutationResult: {
      newChannelInfo: {
        id: string;
        name: string;
        branchMapping: string;
      };
      logMessage: string;
    };
    if (!isRollout) {
      rolloutMutationResult = await startRolloutAsync(graphqlClient, {
        channelName,
        branchName:
          branchName ??
          (await promptForBranchNameAsync({
            graphqlClient,
            projectId,
            channelName,
            nonInteractive,
            json: jsonFlag,
          })),
        percent,
        nonInteractive,
        projectId,
        displayName: projectDisplayName,
        currentBranchMapping,
        channel,
      });
    } else if (endFlag) {
      rolloutMutationResult = await endRolloutAsync(graphqlClient, {
        channelName,
        branchName,
        nonInteractive,
        projectId,
        channel,
      });
    } else {
      rolloutMutationResult = await editRolloutAsync(graphqlClient, {
        channelName,
        percent,
        nonInteractive,
        currentBranchMapping,
        channel,
      });
    }
    if (!rolloutMutationResult) {
      throw new Error('rollout result is empty');
    }
    const { newChannelInfo, logMessage } = rolloutMutationResult;
    if (jsonFlag) {
      printJsonOnlyOutput(newChannelInfo);
    } else {
      Log.withTick(logMessage);
    }
  }
}

async function promptForBranchNameAsync({
  graphqlClient,
  projectId,
  channelName,
  nonInteractive,
  json,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  channelName: string;
  nonInteractive: boolean;
  json: boolean;
}): Promise<string> {
  if (nonInteractive) {
    throw new Error('Must supply branch flag in non-interactive mode');
  }

  const { name: branchName } = await selectBranchOnAppAsync(graphqlClient, {
    projectId,
    promptTitle: `Which branch would you like roll out on ${channelName}?`,
    displayTextForListItem: updateBranch => ({
      title: updateBranch.name,
    }),
    // discard limit and offset because this query is not their intended target
    paginatedQueryOptions: {
      json,
      nonInteractive,
      offset: 0,
    },
  });

  return branchName;
}
