import { Flags } from '@oclif/core';

import { formatGraphQLBuild } from '../../build/utils/formatBuild.js';
import EasCommand from '../../commandUtils/EasCommand.js';
import { BuildFragment } from '../../graphql/generated.js';
import { BuildQuery } from '../../graphql/queries/BuildQuery.js';
import Log from '../../log.js';
import { ora } from '../../ora.js';
import { getExpoConfig } from '../../project/expoConfig.js';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils.js';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json.js';

export default class BuildView extends EasCommand {
  static description = 'view a build for your project';

  static args = [{ name: 'BUILD_ID' }];

  static flags = {
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr',
    }),
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
