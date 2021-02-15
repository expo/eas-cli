import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { UpdateBranch } from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountName } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';
import { getBranchNameAsync } from '../../utils/git';

export async function createUpdateBranchOnAppAsync({
  appId,
  branchName,
}: {
  appId: string;
  branchName: string;
}): Promise<Pick<UpdateBranch, 'id' | 'branchName'>> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        { updateBranch: { createUpdateBranchForApp: Pick<UpdateBranch, 'id' | 'branchName'> } },
        { appId: string; branchName: string }
      >(
        gql`
          mutation createUpdateBranchForApp($appId: ID!, $branchName: String!) {
            updateBranch {
              createUpdateBranchForApp(appId: $appId, branchName: $branchName) {
                id
                branchName
              }
            }
          }
        `,
        {
          appId,
          branchName,
        }
      )
      .toPromise()
  );
  return data.updateBranch.createUpdateBranchForApp;
}

export default class BranchCreate extends Command {
  static hidden = true;
  static description = 'Create a branch on the current project.';

  static args = [
    {
      name: 'branchName',
      required: false,
      description: 'Name of the branch to create',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: 'return a json with the new branch ID and name.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { branchName },
      flags,
    } = this.parse(BranchCreate);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }

    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: exp.slug,
    });

    if (!branchName) {
      const validationMessage = 'Branch name may not be empty.';
      if (flags.json) {
        throw new Error(validationMessage);
      }
      ({ branchName } = await promptAsync({
        type: 'text',
        name: 'branchName',
        message: 'Please name the branch:',
        initial:
          (await getBranchNameAsync()) || `branch-${Math.random().toString(36).substr(2, 4)}`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const newBranch = await createUpdateBranchOnAppAsync({ appId: projectId, branchName });

    if (flags.json) {
      Log.log(newBranch);
      return;
    }

    Log.withTick(
      `️Created a new branch: ${chalk.bold(newBranch.branchName)} on project ${chalk.bold(
        `@${accountName}/${exp.slug}`
      )}.`
    );
  }
}
