import { Args, Flags } from '@oclif/core';
import openBrowserAsync from 'better-opn';

import { getProjectPageUrl } from '../build/utils/url';
import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import { ora } from '../ora';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';

// Maps the page argument to its path on the project dashboard. Keys are the accepted
// argument values; multiple keys can point at the same page so both the EAS command name
// (e.g. `build`) and the website's wording (e.g. `builds`) work.
const PROJECT_PAGES: Record<string, string> = {
  build: 'builds',
  builds: 'builds',
  submit: 'submissions',
  submissions: 'submissions',
  update: 'updates',
  updates: 'updates',
  workflow: 'workflows',
  workflows: 'workflows',
  cicd: 'workflows',
  hosting: 'hosting',
  deployments: 'hosting/deployments',
  credentials: 'credentials',
  env: 'environment-variables',
  insights: 'insights',
  observe: 'observe',
  settings: 'settings',
};

export default class Browse extends EasCommand {
  static override description = 'open the project page in a web browser';

  static override args = {
    page: Args.string({
      description: 'Project subpage to open. Defaults to the project dashboard.',
      required: false,
      options: Object.keys(PROJECT_PAGES),
    }),
  };

  static override flags = {
    'no-browser': Flags.boolean({
      char: 'n',
      description: 'Print the URL instead of opening it in a web browser',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(Browse);
    const page = args.page ? PROJECT_PAGES[args.page] : null;

    // this command is interactive by nature (only really run by humans in a terminal)
    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(Browse, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    const url = getProjectPageUrl(account.name, exp.slug, page);

    if (flags['no-browser']) {
      Log.log(url);
      return;
    }

    const failedMessage = `Unable to open a web browser. Project page is available at: ${url}`;
    const spinner = ora(`Opening ${url}`).start();
    try {
      const opened = await openBrowserAsync(url);

      if (opened) {
        spinner.succeed(`Opened ${url}`);
      } else {
        spinner.fail(failedMessage);
      }
    } catch (error) {
      spinner.fail(failedMessage);
      throw error;
    }
  }
}
