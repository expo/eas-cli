import openBrowserAsync from 'better-opn';

import { getProjectDashboardUrl } from '../build/utils/url';
import EasCommand, { EASCommandProjectIdContext } from '../commandUtils/EasCommand';
import { ora } from '../ora';
import { getExpoConfig } from '../project/expoConfig';
import { findProjectRootAsync, getOwnerAccountForProjectIdAsync } from '../project/projectUtils';

export default class Open extends EasCommand {
  static override description = 'open the project page in a web browser';

  static override contextDefinition = {
    ...EASCommandProjectIdContext,
  };

  async runAsync(): Promise<void> {
    // this command is interactive by nature (only really run by humans in a terminal)
    const { projectId } = await this.getContextAsync(Open, {
      nonInteractive: false,
    });
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);

    const account = await getOwnerAccountForProjectIdAsync(projectId);

    const projectName = exp.slug;

    const projectDashboardUrl = getProjectDashboardUrl(account.name, projectName);
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
