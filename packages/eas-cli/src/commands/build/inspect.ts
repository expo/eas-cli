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
  UPLOAD = 'upload',
  PREPARE = 'prepare',
  POST_BUILD = 'postbuild',
}

const STAGE_DESCRIPTION = `Stage of the build you want to reproduce.
    upload - copy of the project that would be uploaded to EAS when building.
    prepare - state of the project just before gradle/xcode build is started.
    postbuild - state of the workingdir after build (the same as "eas build --local").`;

export default class BuildInspect extends EasCommand {
  static description =
    'Inspect the state of the project at specific build stages. Useful for troubleshooting.';

  static flags = {
    platform: flags.enum({
      options: [RequestedPlatform.Android, RequestedPlatform.Ios],
      required: true,
    }),
    profile: flags.string({
      description: 'Name of the build profile from eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
    stage: flags.enum({
      description: STAGE_DESCRIPTION,
      options: [InspectStage.UPLOAD, InspectStage.PREPARE, InspectStage.POST_BUILD],
      required: true,
    }),
    output: flags.string({
      description: 'Directory where results will be copied.',
      required: true,
      helpValue: 'OUTPUT_DIRECTORY',
    }),
    force: flags.boolean({
      description: 'Force override if "OUTPUT_DIRECTORY" directory already exists.',
      default: false,
    }),
    verbose: flags.boolean({
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = this.parse(BuildInspect);
    const outputDirectory = path.resolve(flags.output);
    await this.prepareOutputDirAsync(outputDirectory, flags.force);
    if (flags.stage === InspectStage.UPLOAD) {
      const vcs = getVcsClient();
      await vcs.ensureRepoExistsAsync();
      await vcs.makeShallowCopyAsync(outputDirectory);
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
          local: true,
          localBuildOptions: {
            ...(flags.stage === InspectStage.PREPARE ? { prepareOnly: true } : {}),
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
          Log.error('Re-run this command with "--verbose" flag to see the error');
        }
      } finally {
        const spinner = ora().start('Copying project to output directory');
        try {
          const tmpBuildDirectory = path.join(tmpWorkingdir, 'build');
          if (await fs.pathExists(tmpBuildDirectory)) {
            await fs.copy(tmpBuildDirectory, outputDirectory);
          }
          await fs.remove(tmpWorkingdir);
          spinner.succeed(`Project written to ${outputDirectory}`);
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
        throw new Error(`File ${outputDir} already exists`);
      }
    }
    await fs.mkdirp(outputDir);
  }
}
