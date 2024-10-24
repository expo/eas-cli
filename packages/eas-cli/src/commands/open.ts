import openBrowserAsync from 'better-opn';

import { getProjectDashboardUrl } from '../build/utils/url';
import EasCommand from '../commandUtils/EasCommand';
import { ora } from '../ora';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';

export default class Open extends EasCommand {
  static override description = 'open the project page in a web browser';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    // this command is interactive by nature (only really run by humans in a terminal)
    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(Open, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

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
    } catch (error) {
      spinner.fail(failedMessage);
      throw error;
    }
  }
}
