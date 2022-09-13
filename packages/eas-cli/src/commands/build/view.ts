import { formatGraphQLBuild } from '../../build/utils/formatBuild';
import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { BuildFragment } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class BuildView extends EasCommand {
  static override description = 'view a build for your project';

  static override args = [{ name: 'BUILD_ID' }];

  static override flags = {
    ...EasJsonOnlyFlag,
  };

  async runAsync(): Promise<void> {
    const {
      args: { BUILD_ID: buildId },
      flags,
    } = await this.parse(BuildView);
    if (flags.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);

    // this command is always non-interactive
    const projectId = await getProjectIdAsync(exp, { nonInteractive: true });
    const projectName = await getProjectFullNameAsync(exp, { nonInteractive: true });

    const spinner = ora().start('Fetching the build…');

    try {
      let build: BuildFragment;

      if (buildId) {
        build = await BuildQuery.byIdAsync(buildId);
      } else {
        const builds = await BuildQuery.viewBuildsOnAppAsync({
          appId: projectId,
          offset: 0,
          limit: 1,
        });
        if (builds.length === 0) {
          spinner.fail(`Couldn't find any builds for the project ${projectName}`);
          return;
        }
        build = builds[0];
      }

      if (buildId) {
        spinner.succeed(`Found a matching build for the project ${projectName}`);
      } else {
        spinner.succeed(`Showing the last build for the project ${projectName}`);
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
          `Something went wrong and we couldn't fetch the last build for the project ${projectName}`
        );
      }

      throw err;
    }
  }
}
