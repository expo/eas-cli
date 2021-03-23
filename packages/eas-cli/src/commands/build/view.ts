import { getConfig } from '@expo/config';
import { Command } from '@oclif/command';
import ora from 'ora';

import { formatGraphQLBuild } from '../../build/utils/formatBuild';
import { BuildFragment } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';

export default class BuildView extends Command {
  static description = 'view a build for your project';

  static args = [{ name: 'BUILD_ID' }];

  async run() {
    const { BUILD_ID: buildId } = this.parse(BuildView).args;

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);
    const projectName = await getProjectFullNameAsync(exp);

    const spinner = ora().start('Fetching the build…');

    try {
      let build: BuildFragment;

      if (buildId) {
        build = await BuildQuery.byIdAsync(buildId);
      } else {
        const builds = await BuildQuery.allForAppAsync(projectId, { limit: 1 });
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

      Log.log(`\n${formatGraphQLBuild(build)}`);
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
