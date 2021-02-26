import { getConfig } from '@expo/config';
import { getRuntimeVersion } from '@expo/config-plugins/build/android/Updates';
import { Command, flags } from '@oclif/command';
import assert from 'assert';
import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';
import gql from 'graphql-tag';
import uniqBy from 'lodash/uniqBy';
import ora from 'ora';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { Update, UpdateInfoGroup } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getBranchByNameAsync,
  getProjectAccountNameAsync,
} from '../../project/projectUtils';
import {
  buildBundlesAsync,
  buildUpdateInfoGroupAsync,
  collectAssets,
  uploadAssetsAsync,
} from '../../project/publish';
import { promptAsync, selectAsync } from '../../prompts';
import { getLastCommitMessageAsync } from '../../utils/git';

const PAGE_LIMIT = 10_000;

async function viewUpdateBranchAsync({
  appId,
  name,
}: {
  appId: string;
  name: string;
}): Promise<{
  id: string;
  name: string;
  updates: Update[];
}> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        {
          app: {
            byId: {
              updateBranchByName: {
                id: string;
                name: string;
                updates: Update[];
              };
            };
          };
        },
        {
          appId: string;
          name: string;
          limit: number;
        }
      >(
        gql`
          query ViewBranch($appId: String!, $name: String!, $limit: Int!) {
            app {
              byId(appId: $appId) {
                id
                updateBranchByName(name: $name) {
                  id
                  name
                  updates(offset: 0, limit: $limit) {
                    id
                    group
                    message
                    createdAt
                    runtimeVersion
                    platform
                    manifestFragment
                    actor {
                      id
                      ... on User {
                        firstName
                      }
                      ... on Robot {
                        firstName
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          appId,
          name,
          limit: PAGE_LIMIT,
        }
      )
      .toPromise()
  );
  return data.app.byId.updateBranchByName;
}
export default class BranchRepublish extends Command {
  static hidden = true;
  static description = 'Republish an update group to a branch.';

  static flags = {
    branch: flags.string({
      description: 'name of the branch to publish on.',
    }),
    message: flags.string({
      description: 'Short message describing the republish.',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the new update group.`,
      default: false,
    }),
  };

  async run() {
    const {
      flags: { json: jsonFlag, branch: name },
    } = this.parse(BranchRepublish);
    let {
      flags: { message },
    } = this.parse(BranchRepublish);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }

    const accountName = await getProjectAccountNameAsync(projectDir);
    const {
      exp: { slug },
    } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    const { id: branchId, updates } = await viewUpdateBranchAsync({
      appId: projectId,
      name: name!,
    });

    const updateGroups = uniqBy(updates, u => u.group).map(update => ({
      title: formatUpdateTitle(update),
      value: update.group,
    }));
    const updateGroup = await selectAsync<string>(
      'which update would you like to republish?',
      updateGroups
    );

    const updatesToRepublish = updates.filter(update => update.group === updateGroup);
    const { message: oldMessage, runtimeVersion: oldRuntimeVersion } = updatesToRepublish[0]; // These are the same for each member of an update group
    const updateInfoGroup: UpdateInfoGroup = {};
    for (const update of updatesToRepublish) {
      const { platform, manifestFragment } = update;
      updateInfoGroup[platform as 'android' | 'ios'] = JSON.parse(manifestFragment);
    }

    if (!message) {
      const validationMessage = 'publish message may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      const { publishMessage } = await promptAsync({
        type: 'text',
        name: 'publishMessage',
        message: `Please enter a publication message.`,
        initial: `Republish "${oldMessage}" - group: ${updateGroup}`,
        validate: value => (value ? true : validationMessage),
      });
      message = publishMessage;
    }

    let newUpdateGroup;
    const publishSpinner = ora('Republishing...').start();
    try {
      assert(oldRuntimeVersion, 'runtimeVersion must be defined.');
      newUpdateGroup = await PublishMutation.publishUpdateGroupAsync({
        branchId,
        updateInfoGroup,
        runtimeVersion: oldRuntimeVersion,
        message,
      });
      publishSpinner.succeed('Republished!');
    } catch (e) {
      publishSpinner.fail('Failed to published updates');
      throw e;
    }

    if (jsonFlag) {
      Log.log(JSON.stringify(newUpdateGroup));
    } else {
      const outputMessage = new Table({
        wordWrap: true,
        chars: {
          top: '',
          'top-mid': '',
          'top-left': '',
          'top-right': '',
          bottom: '',
          'bottom-mid': '',
          'bottom-left': '',
          'bottom-right': '',
          left: '',
          'left-mid': '',
          mid: '',
          'mid-mid': '',
          right: '',
          'right-mid': '',
          middle: ' ',
        },
        style: { 'padding-left': 0, 'padding-right': 0 },
      });
      outputMessage.push(
        [chalk.dim('project'), `@${accountName}/${slug}`],
        [chalk.dim('branch'), name],
        [chalk.dim('runtimeVersion'), oldRuntimeVersion],
        [chalk.dim('groupID'), newUpdateGroup.group],
        [chalk.dim('message'), message]
      );
      Log.log(outputMessage.toString());
    }
  }
}

function formatUpdateTitle(update: Update): string {
  const { message, createdAt, actor, runtimeVersion } = update;
  return `[${dateFormat(createdAt, 'mmm dd HH:MM')} by ${
    actor?.firstName ?? 'unknown'
  }, runtimeVersion: ${runtimeVersion}] ${message}`;
}
