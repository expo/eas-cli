import openBrowserAsync from 'better-opn';

import { getProjectDashboardUrl } from '../build/utils/url';
import EasCommand from '../commandUtils/EasCommand';
import { ora } from '../ora';
import { getExpoConfig } from '../project/expoConfig';
import {
  fetchProjectIdFromServerAsync,
  findProjectRootAsync,
  getProjectAccountName,
} from '../project/projectUtils';
import { ensureLoggedInAsync } from '../user/actions';

export default class Open extends EasCommand {
  static override description = 'open the project page in a web browser';

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);

    // this ensures the project exists
    await fetchProjectIdFromServerAsync(exp);

    const user = await ensureLoggedInAsync();
    const accountName = getProjectAccountName(exp, user);
    const projectName = exp.slug;

    const projectDashboardUrl = getProjectDashboardUrl(accountName, projectName);
    const failedMessage = `Unable to open a web browser. Project page is available at: ${projectDashboardUrl}`;
    const spinner = ora(`Opening ${projectDashboardUrl}`).start();
    try {
      const opened = await openBrowserAsync(projectDashboardUrl);

      if (opened) {
        spinner.succeed(`Opened ${projectDashboardUrl}`);
      } else {
        spinner.fail(failedMessage);
      }
      return;
    } catch (error) {
      spinner.fail(failedMessage);
      throw error;
    }
  }
}
