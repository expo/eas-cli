import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';

import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getBranchByNameAsync,
  getProjectAccountNameAsync,
} from '../../project/projectUtils';
import { promptAsync, selectAsync } from '../../prompts';
import { updateChannelBranchMappingAsync } from './edit';
import { getBranchMapping, getUpdateChannelByNameForAppAsync } from './view';

async function getRolloutPercentAsync({
  validationMessage,
  promptMessage,
}: {
  validationMessage: string;
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
      /**
       * Don't allow 100 to emphasise to the developer that rollouts have an open right hand endpoint: [0,N)
       *
       * This is unavoidable since the comparision must either be a strict inequality or a weak one. A weak
       * comparison would result in (0,100]. Assuming the new branch is more dangerous, we choose [0,N) to allow
       * '0 percent' rollouts.
       */
      const floatValue = parseFloat(rolloutPercent);
      return Number.isInteger(floatValue) && floatValue >= 0 && floatValue <= 99
        ? true
        : validationMessage;
    },
  });
  return rolloutPercent;
}

export default class ChannelRollout extends Command {
  static hidden = true;
  static description = 'Rollout a new branch out to a channel incrementally.';

  static args = [
    {
      name: 'channel',
      required: true,
      description: 'rollout that the channel is on',
    },
  ];

  static flags = {
    branch: flags.string({
      description: 'branch to rollout',
      required: false,
    }),
    percent: flags.integer({
      description: 'percent of traffic to redirect to the new branch',
      required: false,
    }),
    end: flags.boolean({
      description: 'End the rollout.',
      default: false,
    }),
    json: flags.boolean({
      description:
        'print output as a JSON object with the new channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async run() {
    const {
      args: { channel: channelName },
      flags: { json: jsonFlag, end: endFlag },
    } = this.parse(ChannelRollout);
    let {
      flags: { branch: branchName, percent },
    } = this.parse(ChannelRollout);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);
    const { slug } = exp;
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    const getUpdateChannelByNameForAppResult = await getUpdateChannelByNameForAppAsync({
      appId: projectId,
      channelName: channelName!,
    });
    const { branchMapping: currentBranchMapping, isRollout } = getBranchMapping(
      getUpdateChannelByNameForAppResult
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
    let newChannelInfo, logMessage;
    if (!isRollout) {
      if (!branchName) {
        const validationMessage = 'A branch must be specified.';
        if (jsonFlag) {
          throw new Error(validationMessage);
        }
        ({ name: branchName } = await promptAsync({
          type: 'text',
          name: 'name',
          message: `Select a branch to rollout onto ${channelName}`,
          validate: value => (value ? true : validationMessage),
        }));
      }
      const branch = await getBranchByNameAsync({ appId: projectId, name: branchName! });

      if (percent === undefined) {
        const promptMessage = `What percent of users should be directed to the branch ${branchName}?`;
        const validationMessage =
          'The rollout percentage must be an integer between 0 and 99 inclusive.';
        if (jsonFlag) {
          throw new Error(validationMessage);
        }
        percent = await getRolloutPercentAsync({ promptMessage, validationMessage });
      }

      const newBranchMapping = {
        version: 0,
        data: [
          {
            branchId: branch.id,
            branchMappingLogic: {
              operand: percent! / 100,
              clientKey: 'rolloutToken',
              branchMappingOperator: 'hash_lt',
            },
          },
          currentBranchMapping.data[0],
        ],
      };
      newChannelInfo = await updateChannelBranchMappingAsync({
        channelId: getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.id!,
        branchMapping: JSON.stringify(newBranchMapping),
      });

      const oldBranchId = currentBranchMapping.data[0].branchId;
      const oldBranch = getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.updateBranches.filter(
        branch => branch.id === oldBranchId
      )[0];
      if (!oldBranch) {
        throw new Error(
          `Branch mapping is missing its only branch for channel "${channelName}" on app "@${accountName}/${slug}"`
        );
      }

      logMessage = `️Started a rollout of branch ${chalk.bold(
        branchName
      )} onto channel ${chalk.bold(channelName!)}! ${chalk.bold(
        percent
      )}% of users will be directed to ${chalk.bold(branchName)}, ${chalk.bold(
        100 - percent!
      )}% to ${oldBranch.name}.`;
    } else {
      // not a rollout
      if (!endFlag) {
        const currentPercent = 100 * currentBranchMapping.data[0].branchMappingLogic.operand;
        const [newBranchId, oldBranchId] = currentBranchMapping.data.map(d => d.branchId);
        const newBranch = getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.updateBranches.filter(
          branch => branch.id === newBranchId
        )[0];
        const oldBranch = getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.updateBranches.filter(
          branch => branch.id === oldBranchId
        )[0];
        if (!newBranch || !oldBranch) {
          throw new Error(
            `Branch mapping rollout is missing a branch for channel "${channelName}" on app "@${accountName}/${slug}"`
          );
        }

        if (percent === undefined) {
          if (jsonFlag) {
            throw new Error(
              'A rollout is already in progress. If you wish to modify it you must use specify the new rollout percentage with the --percent flag.'
            );
          }
          const promptMessage = `Currently ${currentPercent}% of all users are routed to branch ${
            newBranch.name
          } and ${100 - currentPercent}% of all users are routed to branch ${
            oldBranch.name
          }. What percent of users should be directed to the branch ${newBranch.name}?`;
          const validationMessage =
            'The rollout percentage must be an integer between 0 and 99 inclusive.';
          if (jsonFlag) {
            throw new Error(validationMessage);
          }
          percent = await getRolloutPercentAsync({ promptMessage, validationMessage });
        }

        const newBranchMapping = { ...currentBranchMapping };
        newBranchMapping.data[0].branchMappingLogic.operand = percent / 100;

        newChannelInfo = await updateChannelBranchMappingAsync({
          channelId: getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.id!,
          branchMapping: JSON.stringify(newBranchMapping),
        });

        logMessage = `️Rollout of branch ${chalk.bold(newBranch.name)} onto channel ${chalk.bold(
          channelName!
        )} updated from ${chalk.bold(currentPercent)}% to ${chalk.bold(percent)}%. ${chalk.bold(
          percent
        )}% of users will be directed to ${chalk.bold(newBranch.name)}, ${chalk.bold(
          100 - percent!
        )}% to ${oldBranch.name}.`;
      } else {
        // end flag is true
        const currentPercent = 100 * currentBranchMapping.data[0].branchMappingLogic.operand;
        const [newBranchId, oldBranchId] = currentBranchMapping.data.map(d => d.branchId);
        const newBranch = getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.updateBranches.filter(
          branch => branch.id === newBranchId
        )[0];
        const oldBranch = getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.updateBranches.filter(
          branch => branch.id === oldBranchId
        )[0];
        if (!newBranch || !oldBranch) {
          throw new Error(
            `Branch mapping rollout is missing a branch for channel "${channelName}" on app "@${accountName}/${slug}"`
          );
        }

        const endOnNewBranch = await selectAsync<boolean>(
          'Ending the rollout will send all traffic to a single branch. Which one should that be?',
          [
            {
              title: `${newBranch.name} ${chalk.grey(
                `- current percent: ${100 - currentPercent}%`
              )}`,
              value: true,
            },
            {
              title: `${oldBranch.name} ${chalk.grey(`- current percent: ${currentPercent}%`)}`,
              value: false,
            },
          ]
        );

        const newBranchMapping = {
          version: 0,
          data: [
            {
              branchId: endOnNewBranch ? newBranchId : oldBranchId,
              branchMappingLogic: 'true',
            },
          ],
        };

        newChannelInfo = await updateChannelBranchMappingAsync({
          channelId: getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.id!,
          branchMapping: JSON.stringify(newBranchMapping),
        });
        logMessage = `️Rollout on channel ${chalk.bold(
          channelName
        )} ended. All traffic is now sent to ${chalk.bold(
          endOnNewBranch ? newBranch.name : oldBranch.name
        )}`;
      }
    }

    if (jsonFlag) {
      Log.log(JSON.stringify(newChannelInfo));
      return;
    }

    Log.withTick(logMessage);
  }
}
