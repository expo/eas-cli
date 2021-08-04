import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';
import { groupBy } from 'lodash';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { ViewBranchQuery, ViewBranchQueryVariables } from '../../graphql/generated';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../../update/utils';
import formatFields from '../../utils/formatFields';

const PAGE_LIMIT = 10_000;

export async function viewUpdateBranchAsync({
  appId,
  name,
}: Pick<ViewBranchQueryVariables, 'appId' | 'name'>): Promise<ViewBranchQuery> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<ViewBranchQuery, ViewBranchQueryVariables>(
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
                        username
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
  return data;
}

export default class BranchView extends Command {
  static hidden = true;
  static description = 'View a branch.';

  static args = [
    {
      name: 'name',
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
      args: { name },
      flags: { json: jsonFlag },
    } = this.parse(BranchView);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }

    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    if (!name) {
      const validationMessage = 'Branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please enter the name of the branch to view:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    // return data.app?.byId.updateBranchByName;
    const { app } = await viewUpdateBranchAsync({
      appId: projectId,
      name,
    });
    const UpdateBranch = app?.byId.updateBranchByName;
    if (!UpdateBranch) {
      throw new Error(`Could not find branch "${name}"`);
    }

    const updates = Object.values(groupBy(UpdateBranch.updates, u => u.group)).map(
      group => group[0]
    );

    if (jsonFlag) {
      Log.log(JSON.stringify({ ...UpdateBranch, updates }));
      return;
    }

    const groupTable = new Table({
      head: UPDATE_COLUMNS,
      wordWrap: true,
    });

    for (const update of updates) {
      groupTable.push([
        formatUpdate(update),
        update.runtimeVersion,
        update.group,
        getPlatformsForGroup({
          updates: UpdateBranch.updates,
          group: update.group,
        }),
      ]);
    }

    Log.addNewLineIfNone();
    Log.log(chalk.bold('Branch:'));
    Log.log(
      formatFields([
        { label: 'Name', value: UpdateBranch.name },
        { label: 'ID', value: UpdateBranch.id },
      ])
    );
    Log.addNewLineIfNone();
    Log.log(chalk.bold('Recently published update groups:'));
    Log.log(groupTable.toString());
  }
}
