import chalk from 'chalk';

import { SetUpTargetBuildCredentialsFromCredentialsJson } from './SetUpTargetBuildCredentialsFromCredentialsJson';
import { IosDistributionType } from '../../../graphql/generated';
import Log from '../../../log';
import { findApplicationTarget } from '../../../project/ios/target';
import { CredentialsContext } from '../../context';
import { readIosCredentialsAsync } from '../../credentialsJson/read';
import { IosCredentials } from '../../credentialsJson/types';
import { ensureAllTargetsAreConfigured } from '../../credentialsJson/utils';
import { App, Target } from '../types';

export class SetUpBuildCredentialsFromCredentialsJson {
  constructor(
    private readonly app: App,
    private readonly targets: Target[],
    private readonly distributionType: IosDistributionType
  ) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    const credentialsJson = await this.readCredentialsJsonAsync(ctx);
    ensureAllTargetsAreConfigured(this.targets, credentialsJson);

    const hasManyTargets = this.targets.length > 1;
    for (const target of this.targets) {
      if (hasManyTargets) {
        Log.newLine();
        Log.log(
          `Setting up credentials for target ${chalk.bold(target.targetName)} (${
            target.bundleIdentifier
          })`
        );
        Log.newLine();
      }
      await new SetUpTargetBuildCredentialsFromCredentialsJson(
        {
          account: this.app.account,
          projectName: this.app.projectName,
          bundleIdentifier: target.bundleIdentifier,
          parentBundleIdentifier: target.parentBundleIdentifier,
        },
        this.distributionType,
        credentialsJson[target.targetName]
      ).runAsync(ctx);
    }
  }

  private async readCredentialsJsonAsync(ctx: CredentialsContext): Promise<IosCredentials> {
    const applicationTarget = findApplicationTarget(this.targets);
    try {
      return await readIosCredentialsAsync(ctx.projectDir, applicationTarget);
    } catch (error) {
      Log.error(
        'Reading credentials from credentials.json failed. Make sure this file is correct and all credentials are present there.'
      );
      throw error;
    }
  }
}
