import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import ora from 'ora';

import { apiClient } from '../../api';
import { Build } from '../../build/types';
import formatBuild from '../../build/utils/formatBuild';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';

export default class BuildList extends Command {
  static description = 'list all builds for your project';

  static flags = {
    platform: flags.enum({ options: ['all', 'android', 'ios'] }),
    status: flags.enum({ options: ['in-queue', 'in-progress', 'errored', 'finished', 'canceled'] }),
    limit: flags.integer(),
  };

  async run() {
    const { platform, status, limit = 10 } = this.parse(BuildList).flags;

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);
    const accountName = await getProjectAccountNameAsync(exp);
    const projectName = await getProjectFullNameAsync(exp);

    const spinner = ora().start('Fetching the build list for the project…');

    try {
      const response = await apiClient.get<{ data: { builds: Build[] } }>(
        `projects/${projectId}/builds`,
        {
          searchParams: { platform, status, limit },
          responseType: 'json',
        }
      );

      const { builds } = response.body.data;

      if (builds.length) {
        if (platform || status) {
          spinner.succeed(
            `Showing ${builds.length} matching builds for the project ${projectName}`
          );
        } else {
          spinner.succeed(`Showing last ${builds.length} builds for the project ${projectName}`);
        }

        const list = builds
          .map(build => formatBuild(build, { accountName }))
          .join(`\n\n${chalk.dim('———')}\n\n`);

        Log.log(`\n${list}`);
      } else {
        spinner.fail(`Couldn't find any builds for the project ${projectName}`);
      }
    } catch (e) {
      spinner.fail(`Something went wrong and we couldn't fetch the build list ${projectName}`);
      throw e;
    }
  }
}
