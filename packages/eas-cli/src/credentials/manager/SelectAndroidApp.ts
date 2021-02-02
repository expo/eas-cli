import chalk from 'chalk';

import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { AndroidCredentials } from '../android/credentials';
import { printAndroidCredentials } from '../android/utils/printCredentials';
import { Context } from '../context';
import { ManageAndroidApp } from './ManageAndroidApp';

export class SelectAndroidApp implements Action {
  private firstRun = true;
  constructor(private askAboutProjectMode = true) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    while (true) {
      try {
        const firstRun = this.firstRun;
        this.firstRun = false;

        if (ctx.hasProjectContext && this.askAboutProjectMode && firstRun) {
          const projectFullName = `@${getProjectAccountName(ctx.exp, ctx.user)}/${ctx.exp.slug}`;
          const runProjectContext = await confirmAsync({
            message: `You are currently in a directory with project ${chalk.green(
              projectFullName
            )}. Do you want to select it?`,
          });

          if (runProjectContext) {
            await manager.runActionAsync(new ManageAndroidApp(projectFullName));
            continue;
          }
        }

        const credentials = await ctx.android.fetchAllAsync();
        await printAndroidCredentials(Object.values(credentials));

        const appChoices = Object.values(credentials).map((cred: AndroidCredentials) => ({
          title: cred.experienceName,
          value: cred.experienceName,
        }));
        const { projectFullName } = await promptAsync({
          type: 'select',
          name: 'projectFullName',
          message: 'Select application',
          choices: [...appChoices, { title: '[Quit]', value: 'quit' }],
        });

        if (projectFullName === 'quit') {
          return;
        }
        await manager.runActionAsync(new ManageAndroidApp(projectFullName));
      } catch (err) {
        Log.error(err);
      }
    }
  }
}
