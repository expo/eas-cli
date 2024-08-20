import { DistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { SetUpTargetBuildCredentials } from './SetUpTargetBuildCredentials';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { App, IosAppBuildCredentialsMap, IosCredentials, Target } from '../types';
import { displayProjectCredentials } from '../utils/printCredentials';

interface Options {
  app: App;
  targets: Target[];
  distribution: DistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
}

export class SetUpBuildCredentials {
  constructor(private readonly options: Options) {}

  async runAsync(ctx: CredentialsContext): Promise<IosCredentials> {
    const hasManyTargets = this.options.targets.length > 1;
    const iosAppBuildCredentialsMap: IosAppBuildCredentialsMap = {};
    if (hasManyTargets) {
      Log.newLine();
      Log.log(`We found that the scheme you want to build consists of many targets.`);
      Log.log(`You have to set up credentials for each of the targets.`);
      Log.log(
        `They can share the same Distribution Certificate but require separate Provisioning Profiles.`
      );
      Log.newLine();
      Log.log(`Setting up credentials for following targets:`);
      for (const { targetName, bundleIdentifier } of this.options.targets) {
        Log.log(`- Target: ${chalk.bold(targetName)}`);
        Log.log(`  Bundle Identifier: ${chalk.bold(bundleIdentifier)}`);
      }
    }
    for (const target of this.options.targets) {
      if (hasManyTargets) {
        Log.newLine();
        Log.log(
          `Setting up credentials for target ${chalk.bold(target.targetName)} (${chalk.bold(
            target.bundleIdentifier
          )})`
        );
        Log.newLine();
      } else {
        Log.newLine();
      }
      const action = new SetUpTargetBuildCredentials({
        enterpriseProvisioning: this.options.enterpriseProvisioning,
        distribution: this.options.distribution,
        entitlements: target.entitlements,
        target,
        app: {
          ...this.options.app,
          bundleIdentifier: target.bundleIdentifier,
          parentBundleIdentifier: target.parentBundleIdentifier,
        },
      });
      iosAppBuildCredentialsMap[target.targetName] = await action.runAsync(ctx);
    }

    const appInfo = formatAppInfo(this.options.app, this.options.targets);
    Log.newLine();
    displayProjectCredentials(this.options.app, iosAppBuildCredentialsMap, this.options.targets);
    Log.log(chalk.green(`All credentials are ready to build ${chalk.bold(appInfo)}`));
    Log.newLine();

    return toIosCredentials(iosAppBuildCredentialsMap);
  }
}

function toIosCredentials(appBuildCredentialsMap: IosAppBuildCredentialsMap): IosCredentials {
  return Object.entries(appBuildCredentialsMap).reduce((acc, [targetName, appBuildCredentials]) => {
    acc[targetName] = {
      distributionCertificate: {
        certificateP12: nullthrows(appBuildCredentials.distributionCertificate?.certificateP12),
        certificatePassword: nullthrows(
          appBuildCredentials.distributionCertificate?.certificatePassword
        ),
      },
      provisioningProfile: nullthrows(appBuildCredentials.provisioningProfile?.provisioningProfile),
    };
    return acc;
  }, {} as IosCredentials);
}

function formatAppInfo({ account, projectName }: App, targets: Target[]): string {
  const bundleIds = targets.map(target => target.bundleIdentifier);
  return `@${account.name}/${projectName} (${bundleIds.join(', ')})`;
}
