import assert from 'assert';
import chalk from 'chalk';

import {
  BuildError,
  BuildFragment,
  BuildStatus,
  DistributionType,
  EasBuildDeprecationInfo,
  EasBuildDeprecationInfoType,
} from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import {
  appPlatformDisplayNames,
  appPlatformEmojis,
  requestedPlatformDisplayNames,
} from '../constants';
import { getBuildLogsUrl } from './url';

export function printLogsUrls(
  accountName: string,
  builds: { platform: 'android' | 'ios'; buildId: string }[]
): void {
  if (builds.length === 1) {
    const { buildId } = builds[0];
    const logsUrl = getBuildLogsUrl({
      buildId,
      account: accountName,
    });
    Log.log(`Build details: ${chalk.underline(logsUrl)}`);
  } else {
    builds.forEach(({ buildId, platform }) => {
      const logsUrl = getBuildLogsUrl({
        buildId,
        account: accountName,
      });
      Log.log(
        `${requestedPlatformDisplayNames[platform]} build details: ${chalk.underline(logsUrl)}`
      );
    });
  }
}

export function printBuildResults(accountName: string, builds: (BuildFragment | null)[]): void {
  Log.newLine();
  if (builds.length === 1) {
    const [build] = builds;
    assert(build, 'Build should be defined');
    printBuildResult(accountName, build);
  } else {
    (builds.filter(i => i) as BuildFragment[]).forEach(build =>
      printBuildResult(accountName, build)
    );
  }
}

function printBuildResult(accountName: string, build: BuildFragment): void {
  Log.addNewLineIfNone();
  if (build.status === BuildStatus.Errored) {
    const userError = build.error;
    Log.error(
      `${appPlatformEmojis[build.platform]} ${
        appPlatformDisplayNames[build.platform]
      } build failed${userError ? ':' : ''}`
    );
    if (userError) {
      printUserError(userError);
    }
    return;
  }
  if (build.status === BuildStatus.Canceled) {
    Log.error(
      `${appPlatformEmojis[build.platform]} ${
        appPlatformDisplayNames[build.platform]
      } build was canceled`
    );
    return;
  }

  if (build.distribution === DistributionType.Internal) {
    const logsUrl = getBuildLogsUrl({
      buildId: build.id,
      account: accountName,
    });
    Log.log(
      `${appPlatformEmojis[build.platform]} Open this link on your ${
        appPlatformDisplayNames[build.platform]
      } devices to install the app:`
    );
    Log.log(`${chalk.underline(logsUrl)}`);
  } else {
    // TODO: it looks like buildUrl could possibly be undefined, based on the code below.
    // we should account for this case better if it is possible
    const url = build.artifacts?.buildUrl ?? '';
    Log.log(`${appPlatformEmojis[build.platform]} ${appPlatformDisplayNames[build.platform]} app:`);
    Log.log(`${chalk.underline(url)}`);
  }
}

export function printDeprecationWarnings(deprecationInfo?: EasBuildDeprecationInfo | null): void {
  if (!deprecationInfo) {
    return;
  }
  if (deprecationInfo.type === EasBuildDeprecationInfoType.Internal) {
    Log.warn('This command is using API that soon will be deprecated, please update eas-cli.');
    Log.warn("Changes won't affect your project config.");
    Log.warn(deprecationInfo.message);
  } else if (deprecationInfo.type === EasBuildDeprecationInfoType.UserFacing) {
    Log.warn('This command is using API that soon will be deprecated, please update eas-cli.');
    Log.warn(
      'There might be some changes necessary to your project config, latest eas-cli will provide more specific error messages.'
    );
    Log.warn(deprecationInfo.message);
  } else {
    Log.warn('An unexpected warning was encountered. Please report it as a bug:');
    Log.warn(deprecationInfo);
  }
}

export function printUserError(error: BuildError): void {
  Log.error(error.message);
  if (error.docsUrl) {
    Log.error(learnMore(error.docsUrl, { dim: false }));
  }
}
