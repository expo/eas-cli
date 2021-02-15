import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';
import { groupBy } from 'lodash';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { Update } from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

const PAGE_LIMIT = 10_000;

type TruncatedUpdate = Pick<Update, 'updateGroup' | 'updateMessage' | 'createdAt' | 'actor'>;

async function viewUpdateBranchAsync({
  appId,
  branchName,
}: {
  appId: string;
  branchName: string;
}): Promise<{
  id: string;
  branchName: string;
  updates: TruncatedUpdate[];
}> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        {
          app: {
            byId: {
              updateBranchByBranchName: {
                id: string;
                branchName: string;
                updates: TruncatedUpdate[];
              };
            };
          };
        },
        {
          appId: string;
          branchName: string;
          limit: number;
        }
      >(
        gql`
          query ViewBranch($appId: String!, $branchName: String!, $limit: Int!) {
            app {
              byId(appId: $appId) {
                id
                updateBranchByBranchName(branchName: $branchName) {
                  id
                  branchName
                  updates(offset: 0, limit: $limit) {
                    id
                    updateGroup
                    updateMessage
                    createdAt
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
          branchName,
          limit: PAGE_LIMIT,
        }
      )
      .toPromise()
  );
  return data.app.byId.updateBranchByBranchName;
}

export default class BranchView extends Command {
  static hidden = true;
  static description = 'View a branch.';

  static args = [
    {
      name: 'branchName',
      required: false,
      description: 'Name of the branch to view',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: `return a json with the branch's ID name and recent update groups.`,
      default: false,
    }),
  };

  async run() {
    let {
      args: { branchName },
      flags: { json: jsonFlag },
    } = this.parse(BranchView);

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

    if (!branchName) {
      const validationMessage = 'Branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ branchName } = await promptAsync({
        type: 'text',
        name: 'branchName',
        message: 'Please enter the name of the branch to view:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const UpdateBranch = await viewUpdateBranchAsync({
      appId: projectId,
      branchName,
    });

    const updates = Object.values(groupBy(UpdateBranch.updates, u => u.updateGroup)).map(
      updateGroup => updateGroup[0]
    );

    if (jsonFlag) {
      Log.log({ ...UpdateBranch, updates });
      return;
    }

    const updateGroupTable = new Table({
      head: ['createdAt', 'updateMessage', 'updateGroup', 'actor'],
      wordWrap: true,
    });

    for (const update of updates) {
      updateGroupTable.push([
        new Date(update.createdAt).toLocaleString(),
        update.updateMessage,
        update.updateGroup,
        update.actor?.firstName,
      ]);
    }

    Log.withTick(
      `️Branch: ${chalk.bold(UpdateBranch.branchName)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}. Branch ID: ${chalk.bold(UpdateBranch.id)}`
    );
    Log.log(chalk.bold('Recent update groups published on this branch:'));
    Log.log(updateGroupTable.toString());
  }
}
