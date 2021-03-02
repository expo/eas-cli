import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { Update } from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

async function deleteUpdateByIdAsync({
  updateId,
}: {
  updateId: Update['id'];
}): Promise<Pick<Update, 'id'>> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation(
        gql`
          mutation DeleteUpdateById($updateId: ID!) {
            update {
              deleteUpdate(updateId: $updateId) {
                id
              }
            }
          }
        `,
        { updateId }
      )
      .toPromise()
  );
  return data.update.deleteUpdate;
}

export default class UpdateDelete extends Command {
  static hidden = true;
  static description = 'Delete an update on the current project';

  static args = [
    {
      name: 'updateId',
      required: false,
      description: 'ID of the update to delete',
    },
  ];

  static flags = {
    force: flags.boolean({
      description: 'Delete the update without prompting for confirmation',
      default: false,
    }),
    json: flags.boolean({
      description: 'Print output as a JSON object containing the deleted update ID',
      default: false,
    }),
  };

  async run() {
    let {
      args: { updateId },
      flags: { json: jsonFlag, force: forceFlag },
    } = this.parse(UpdateDelete);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const accountName = await getProjectAccountNameAsync(projectDir);
    const {
      exp: { slug },
    } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    if (!updateId) {
      const validationMessage = 'Update ID may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: updateId } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please enter the ID of the update:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    Log.warn(
      chalk`⚠️  This will delete all assets from the update, {red this action is IRREVERSIBLE}.`
    );
    Log.log(
      chalk`Users with the update installed will continue to use this update, {bold branch:republish} is likely what you want.`
    );

    if (!forceFlag) {
      if (jsonFlag) {
        throw new Error('Confirmation required, use --force flag to skip this.');
      }
      const { confirm } = await promptAsync({
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to do this?',
        initial: false,
      });
      if (!confirm) {
        return;
      }
    }

    const update = await deleteUpdateByIdAsync({ updateId });

    if (jsonFlag) {
      Log.log(JSON.stringify(update));
      return;
    }

    Log.withTick(chalk`Deleted update group {bold ${update.id}}`);
  }
}
