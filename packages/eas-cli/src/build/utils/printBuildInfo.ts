import assert from 'assert';
import chalk from 'chalk';
import indentString from 'indent-string';
import qrcodeTerminal from 'qrcode-terminal';

import {
  AppPlatform,
  BuildError,
  BuildFragment,
  BuildStatus,
  DistributionType,
  EasBuildDeprecationInfo,
  EasBuildDeprecationInfoType,
} from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { appPlatformDisplayNames, appPlatformEmojis } from '../../platform';
import { printJsonOnlyOutput } from '../../utils/json';
import { getBuildLogsUrl, getInternalDistributionInstallUrl } from './url';

export function printLogsUrls(builds: BuildFragment[]): void {
  if (builds.length === 1) {
    Log.log(`Build details: ${chalk.underline(getBuildLogsUrl(builds[0]))}`);
  } else {
    builds.forEach(build => {
      const logsUrl = getBuildLogsUrl(build);
      Log.log(
        `${appPlatformDisplayNames[build.platform]} build details: ${chalk.underline(logsUrl)}`
      );
    });
  }
}

export function printBuildResults(builds: (BuildFragment | null)[], json: boolean): void {
  if (json) {
    printJsonOnlyOutput(builds);
  } else {
    Log.newLine();
    if (builds.length === 1) {
      const [build] = builds;
      assert(build, 'Build should be defined');
      printBuildResult(build);
    } else {
      (builds.filter(i => i) as BuildFragment[]).forEach(build => printBuildResult(build));
    }
  }
}

function printBuildResult(build: BuildFragment): void {
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
    const logsUrl = getBuildLogsUrl(build);
    // It's tricky to install the .apk file directly on Android so let's fallback
    // to the build details page and let people press the button to download there
    const qrcodeUrl =
      build.platform === AppPlatform.Ios ? getInternalDistributionInstallUrl(build) : logsUrl;
    qrcodeTerminal.generate(qrcodeUrl, { small: true }, code =>
      Log.log(`${indentString(code, 2)}\n`)
    );
    Log.log(
      `${appPlatformEmojis[build.platform]} Open this link on your ${
        appPlatformDisplayNames[build.platform]
      } devices (or scan the QR code) to install the app:`
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
