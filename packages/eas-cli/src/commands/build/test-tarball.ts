import { Command, Flags } from '@oclif/core';
import fs from 'fs-extra';

import { makeProjectTarballAsync } from '../../build/utils/repository';
import GitClient from '../../vcs/clients/git';

/**
 * Test command to create a project tarball and verify it works cross-platform.
 * Used in CI to test that archives created on Windows can be extracted on Unix/Linux.
 * Does not require an Expo project - works with any git repository.
 */
export default class BuildTestTarball extends Command {
  static override hidden = true;
  static override description = 'Create a project tarball for testing cross-platform compatibility';

  static override flags = {
    output: Flags.string({
      description: 'Output path for the tarball',
      required: false,
    }),
    cwd: Flags.string({
      description: 'Working directory (defaults to current directory)',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BuildTestTarball);
    const cwd = flags.cwd ?? process.cwd();

    this.log(`Creating project tarball from ${cwd}...`);
    this.log(`Platform: ${process.platform}`);

    const vcsClient = new GitClient({
      maybeCwdOverride: cwd,
      requireCommit: false,
    });

    const { path: tarballPath, size } = await makeProjectTarballAsync(vcsClient);

    this.log(`✅ Tarball created successfully: ${tarballPath}`);
    this.log(`Size: ${(size / 1024 / 1024).toFixed(2)} MB`);

    if (flags.output) {
      await fs.copy(tarballPath, flags.output);
      this.log(`Copied to: ${flags.output}`);
      // Output just the path for easy consumption in CI
      console.log(flags.output);
    } else {
      // Output the path for easy consumption in CI
      console.log(tarballPath);
    }
  }
}
