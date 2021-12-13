import { flags } from '@oclif/command';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { findProjectRootAsync } from '../../project/projectUtils';
import { getTmpDirectory } from '../../utils/paths';
import { getVcsClient } from '../../vcs';

enum InspectStage {
  ARCHIVE = 'archive',
  PRE_BUILD = 'pre-build',
  POST_BUILD = 'post-build',
}

const STAGE_DESCRIPTION = `Stage of the build you want to inspect.
    archive - builds the project archive that would be uploaded to EAS when building
    pre-build - prepares the project to be built with Gradle/Xcode. Does not run the native build.
    post-build - builds the native project and leaves the output directory for inspection`;

export default class BuildInspect extends EasCommand {
  static description =
    'Inspect the state of the project at specific build stages. Useful for troubleshooting.';

  static flags = {
    platform: flags.enum({
      char: 'p',
      options: [RequestedPlatform.Android, RequestedPlatform.Ios],
      required: true,
    }),
    profile: flags.string({
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
    stage: flags.enum({
      char: 's',
      description: STAGE_DESCRIPTION,
      options: [InspectStage.ARCHIVE, InspectStage.PRE_BUILD, InspectStage.POST_BUILD],
      required: true,
    }),
    output: flags.string({
      description: 'Output directory.',
      required: true,
      helpValue: 'OUTPUT_DIRECTORY',
    }),
    force: flags.boolean({
      description: 'Delete OUTPUT_DIRECTORY if it already exists.',
      default: false,
    }),
    verbose: flags.boolean({
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = this.parse(BuildInspect);
    const outputDirectory = path.resolve(process.cwd(), flags.output);
    await this.prepareOutputDirAsync(outputDirectory, flags.force);
    if (flags.stage === InspectStage.ARCHIVE) {
      const vcs = getVcsClient();
      await vcs.ensureRepoExistsAsync();
      await vcs.makeShallowCopyAsync(outputDirectory);
      Log.withTick(`Project saved to ${outputDirectory}`);
    } else {
      const projectDir = await findProjectRootAsync();
      const tmpWorkingdir = path.join(getTmpDirectory(), uuidv4());
      try {
        await runBuildAndSubmitAsync(projectDir, {
          skipProjectConfiguration: false,
          nonInteractive: false,
          wait: true,
          clearCache: false,
          json: false,
          autoSubmit: false,
          requestedPlatform: flags.platform,
          profile: flags.profile,
          localBuildOptions: {
            enable: true,
            ...(flags.stage === InspectStage.PRE_BUILD ? { skipNativeBuild: true } : {}),
            ...(flags.stage === InspectStage.POST_BUILD ? { skipCleanup: true } : {}),
            verbose: flags.verbose,
            workingdir: tmpWorkingdir,
            artifactsDir: path.join(tmpWorkingdir, 'artifacts'),
          },
        });
        if (!flags.verbose) {
          Log.log(chalk.green('Build successful'));
        }
      } catch (err) {
        if (!flags.verbose) {
          Log.error('Build failed');
          Log.error(`Re-run this command with ${chalk.bold('--verbose')} flag to see the logs`);
        }
      } finally {
        const spinner = ora().start(`Copying project build directory to ${outputDirectory}`);
        try {
          const tmpBuildDirectory = path.join(tmpWorkingdir, 'build');
          if (await fs.pathExists(tmpBuildDirectory)) {
            await fs.copy(tmpBuildDirectory, outputDirectory);
          }
          await fs.remove(tmpWorkingdir);
          spinner.succeed(`Project build directory saved to ${outputDirectory}`);
        } catch (err) {
          spinner.fail();
          throw err;
        }
      }
    }
  }

  private async prepareOutputDirAsync(outputDir: string, force: boolean): Promise<void> {
    if (await fs.pathExists(outputDir)) {
      if (force) {
        await fs.remove(outputDir);
      } else {
        throw new Error(`Directory ${outputDir} already exists`);
      }
    }
    await fs.mkdirp(outputDir);
  }
}
