import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';
import { groupBy } from 'lodash';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  Maybe,
  Robot,
  Update,
  UpdateBranch,
  User,
  ViewBranchQuery,
  ViewBranchQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { UPDATE_COLUMNS, formatUpdate } from '../update/view';

const PAGE_LIMIT = 10_000;

type TruncatedUpdate = Pick<Update, 'group' | 'message' | 'createdAt' | 'actor'>;

export async function viewUpdateBranchAsync({
  appId,
  name,
}: Pick<ViewBranchQueryVariables, 'appId' | 'name'>): Promise<
  Pick<UpdateBranch, 'id' | 'name'> & {
    updates: (Pick<
      Update,
      'id' | 'group' | 'message' | 'createdAt' | 'runtimeVersion' | 'platform' | 'manifestFragment'
    > & {
      actor?: Maybe<Pick<User, 'firstName' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
    })[];
  }
> {
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
  const updateBranch = data.app?.byId.updateBranchByName;
  if (!updateBranch) {
    throw new Error(`Could not find branch "${name}"`);
  }
  return updateBranch;
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
    const accountName = await getProjectAccountNameAsync(exp);
    const { slug } = exp;
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

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

    const UpdateBranch = await viewUpdateBranchAsync({
      appId: projectId,
      name,
    });

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
      groupTable.push([formatUpdate(update), update.runtimeVersion, update.group]);
    }

    Log.withTick(
      `️Branch: ${chalk.bold(UpdateBranch.name)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}. Branch ID: ${chalk.bold(UpdateBranch.id)}`
    );
    Log.log(chalk.bold('Recent update groups published on this branch:'));
    Log.log(groupTable.toString());
  }
}
