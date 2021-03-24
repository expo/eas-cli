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
import { promptAsync } from '../../prompts';
import { updateChannelBranchMappingAsync } from './edit';
import { getBranchMapping, getUpdateChannelByNameForAppAsync } from './view';

export default class ChannelRollout extends Command {
  static hidden = true;
  static description = 'Rollout a new branch out to a channel incrementally.';

  static args = [
    {
      name: 'action',
      required: true,
      description: 'rollout action',
      options: ['start', 'edit', 'end'],
    },
  ];

  static flags = {
    channel: flags.string({
      description: 'channel on which to rollout',
    }),
    branch: flags.string({
      description: 'branch to rollout',
      required: false,
    }),
    percent: flags.integer({
      description: 'percent of traffic to redirect to the new branch',
      required: false,
    }),
    json: flags.boolean({
      description:
        'print output as a JSON object with the new channel ID, name and branch mapping.',
      default: false,
    }),
  };

  async run() {
    const {
      args: { action },
      flags: { json: jsonFlag },
    } = this.parse(ChannelRollout);
    let {
      flags: { channel: channelName, branch: branchName, percent },
    } = this.parse(ChannelRollout);

    if (!channelName) {
      const validationMessage = 'The rollout channel must be specified.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: channelName } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please name the channel:',
        validate: value => (value ? true : validationMessage),
      }));
    }

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
      throw new Error('This CLI cannot handle branch mappings with more than 2 branches.');
    }

    let newChannelInfo, logMessage;
    switch (action) {
      case 'start': {
        if (isRollout) {
          throw new Error('There is already a rollout in progress.');
        }
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
          const validationMessage =
            'The rollout percentage must be an integer between 0 and 99 inclusive.';
          if (jsonFlag) {
            throw new Error(validationMessage);
          }
          ({ name: percent } = await promptAsync({
            type: 'text',
            name: 'name',
            format: value => {
              return parseInt(value, 10);
            },
            message: `What percent of users should be directed to the new branch ${branchName}?`,
            initial: 0,
            validate: value => {
              const floatValue = parseFloat(value);
              return Number.isInteger(floatValue) && floatValue >= 0 && floatValue <= 99
                ? true
                : validationMessage;
            },
          }));
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

        logMessage = `️Started a rollout of branch ${chalk.bold(
          branchName
        )} onto channel ${chalk.bold(channelName!)}! ${chalk.bold(
          percent
        )}% of users will be directed to ${chalk.bold(branchName)}, ${chalk.bold(
          100 - percent!
        )}% to ${chalk.bold(
          getUpdateChannelByNameForAppResult.app?.byId.updateChannelByName.name
        )}.`;
        break;
      }
      case 'edit':
        throw new Error('Not implemented yet.');
      case 'end':
        throw new Error('Not implemented yet.');
      default:
        throw new Error(`${action} is not a supported action.`);
    }

    if (jsonFlag) {
      Log.log(JSON.stringify(newChannelInfo));
      return;
    }

    Log.withTick(logMessage);
  }
}
