import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import EasCommand, {
  EASCommandDynamicProjectConfigContext,
  EASCommandLoggedInContext,
  EASCommandProjectDirContext,
} from '../../commandUtils/EasCommand';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
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
  static override description =
    'inspect the state of the project at specific build stages, useful for troubleshooting';

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: [RequestedPlatform.Android, RequestedPlatform.Ios],
      required: true,
    }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
    stage: Flags.enum({
      char: 's',
      description: STAGE_DESCRIPTION,
      options: [InspectStage.ARCHIVE, InspectStage.PRE_BUILD, InspectStage.POST_BUILD],
      required: true,
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output directory.',
      required: true,
      helpValue: 'OUTPUT_DIRECTORY',
    }),
    force: Flags.boolean({
      description: 'Delete OUTPUT_DIRECTORY if it already exists.',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandDynamicProjectConfigContext,
    ...EASCommandProjectDirContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildInspect);
    const { actor, getDynamicProjectConfigAsync, projectDir } = await this.getContextAsync(
      BuildInspect,
      {
        nonInteractive: false,
      }
    );

    const outputDirectory = path.resolve(process.cwd(), flags.output);
    const tmpWorkingdir = path.join(getTmpDirectory(), uuidv4());

    if (flags.force && process.cwd().startsWith(outputDirectory)) {
      throw new Error(
        `This operation is not allowed, it would delete all files in ${outputDirectory} including the current project.`
      );
    }

    await this.prepareOutputDirAsync(outputDirectory, flags.force);

    if (flags.stage === InspectStage.ARCHIVE) {
      const vcs = getVcsClient();
      await vcs.ensureRepoExistsAsync();
      await vcs.makeShallowCopyAsync(tmpWorkingdir);
      await this.copyToOutputDirAsync(tmpWorkingdir, outputDirectory);
    } else {
      try {
        await runBuildAndSubmitAsync(
          projectDir,
          {
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
          },
          actor,
          getDynamicProjectConfigAsync
        );
        if (!flags.verbose) {
          Log.log(chalk.green('Build successful'));
        }
      } catch {
        if (!flags.verbose) {
          Log.error('Build failed');
          Log.error(`Re-run this command with ${chalk.bold('--verbose')} flag to see the logs`);
        }
      } finally {
        await this.copyToOutputDirAsync(path.join(tmpWorkingdir, 'build'), outputDirectory);
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

  private async copyToOutputDirAsync(src: string, dst: string): Promise<void> {
    const spinner = ora().start(`Copying project directory to ${dst}`);
    try {
      if (await fs.pathExists(src)) {
        await fs.copy(src, dst);
      }
      await fs.remove(src);
      spinner.succeed(`Project directory saved to ${dst}`);
    } catch (err) {
      spinner.fail();
      throw err;
    }
  }
}
