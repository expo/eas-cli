import { formatGraphQLBuild } from '../../build/utils/formatBuild';
import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { BuildFragment } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class BuildView extends EasCommand {
  static override description = 'view a build for your project';

  static override args = [{ name: 'BUILD_ID' }];

  static override flags = {
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const {
      args: { BUILD_ID: buildId },
      flags,
    } = await this.parse(BuildView);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildView, {
      nonInteractive: true,
    });
    if (flags.json) {
      enableJsonOutput();
    }

    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    const spinner = ora().start('Fetching the build…');

    try {
      let build: BuildFragment;

      if (buildId) {
        build = await BuildQuery.byIdAsync(graphqlClient, buildId);
      } else {
        const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
          appId: projectId,
          offset: 0,
          limit: 1,
        });
        if (builds.length === 0) {
          spinner.fail(`Couldn't find any builds for the project ${displayName}`);
          return;
        }
        build = builds[0];
      }

      if (buildId) {
        spinner.succeed(`Found a matching build for the project ${displayName}`);
      } else {
        spinner.succeed(`Showing the last build for the project ${displayName}`);
      }

      if (flags.json) {
        printJsonOnlyOutput(build);
      } else {
        Log.log(`\n${formatGraphQLBuild(build)}`);
      }
    } catch (err) {
      if (buildId) {
        spinner.fail(`Something went wrong and we couldn't fetch the build with id ${buildId}`);
      } else {
        spinner.fail(
          `Something went wrong and we couldn't fetch the last build for the project ${displayName}`
        );
      }

      throw err;
    }
  }
}
