import chalk from 'chalk';

import { confirmAsync, prompt } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { AndroidCredentials } from '../android/credentials';
import { printAndroidCredentials } from '../android/utils/printCredentials';
import { Context } from '../context';
import { MangeAndroidApp } from './MangeAndroidApp';

export class SelectAndroidApp implements Action {
  private firstRun = true;
  constructor(private askAboutProjectMode = true) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    manager.pushNextAction(this);
    const firstRun = this.firstRun;
    this.firstRun = false;

    if (ctx.hasProjectContext && this.askAboutProjectMode && firstRun) {
      const projectFullName = `@${ctx.exp.owner || ctx.user.username}/${ctx.exp.slug}`;
      const runProjectContext = await confirmAsync({
        message: `You are currently in a directory with project ${chalk.green(
          projectFullName
        )}. Do you want to select it?`,
      });

      if (runProjectContext) {
        manager.pushNextAction(new MangeAndroidApp(projectFullName));
        return;
      }
    }

    const credentials = await ctx.android.fetchAllAsync();
    await printAndroidCredentials(Object.values(credentials));

    const appChoices = Object.values(credentials).map((cred: AndroidCredentials) => ({
      title: cred.experienceName,
      value: cred.experienceName,
    }));
    const { projectFullName } = await prompt({
      type: 'select',
      name: 'projectFullName',
      message: 'Select application',
      choices: [...appChoices, { title: 'Go back to platfom selection', value: 'go-back' }],
    });

    if (projectFullName === 'go-back') {
      manager.popAction();
      return;
    }
    manager.pushNextAction(new MangeAndroidApp(projectFullName));
  }
}
