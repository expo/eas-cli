import assert from 'assert';
import indentString from 'indent-string';
import qrcodeTerminal from 'qrcode-terminal';

import { getBuildLogsUrl, getInternalDistributionInstallUrl } from './url';
import {
  AppPlatform,
  BuildError,
  BuildFragment,
  BuildStatus,
  DistributionType,
  EasBuildDeprecationInfo,
  EasBuildDeprecationInfoType,
} from '../../graphql/generated';
import Log, { learnMore, link } from '../../log';
import { appPlatformDisplayNames, appPlatformEmojis } from '../../platform';

function terminalLinkFallback(url: string, text: string): string {
  return `${text} (${url})`;
}

const errorCodeToErrorMessageOverride: Record<string, (build: BuildFragment) => string> = {
  EAS_BUILD_UNKNOWN_FASTLANE_ERROR: build =>
    `The ${link(getBuildLogsUrl(build, 'run-fastlane'), {
      text: '"Run fastlane"',
      fallback: terminalLinkFallback(getBuildLogsUrl(build, 'run-fastlane'), '"Run fastlane"'),
    })} step failed with an unknown error. Refer to the ${link(
      getBuildLogsUrl(build, 'xcode-logs'),
      {
        text: '"Xcode logs"',
        fallback: terminalLinkFallback(getBuildLogsUrl(build, 'xcode-logs'), '"Xcode logs"'),
      }
    )} phase for additional, more detailed logs`,
  EAS_BUILD_UNKNOWN_GRADLE_ERROR: build =>
    `Gradle build failed with unknown error. See logs for the ${link(
      getBuildLogsUrl(build, 'run-gradlew'),
      {
        text: '"Run gradlew"',
        fallback: terminalLinkFallback(getBuildLogsUrl(build, 'run-gradlew'), '"Run gradlew"'),
      }
    )} phase for more information.`,
};

export function printLogsUrls(builds: BuildFragment[]): void {
  if (builds.length === 1) {
    Log.log(`Build details: ${link(getBuildLogsUrl(builds[0]))}`);
  } else {
    builds.forEach(build => {
      const logsUrl = getBuildLogsUrl(build);
      Log.log(
        `${appPlatformEmojis[build.platform]} ${
          appPlatformDisplayNames[build.platform]
        } build details: ${link(logsUrl)}`
      );
    });
  }
}

export function printBuildResults(builds: (BuildFragment | null)[]): void {
  if (builds.length === 1) {
    const [build] = builds;
    assert(build, 'Build should be defined');
    printBuildResult(build);
  } else {
    (builds.filter(i => i) as BuildFragment[]).forEach(build => {
      printBuildResult(build);
    });
  }
}

function printBuildResult(build: BuildFragment): void {
  if (build.status === BuildStatus.Errored) {
    Log.addNewLineIfNone();
    const userError = build.error;
    Log.error(
      `${appPlatformEmojis[build.platform]} ${
        appPlatformDisplayNames[build.platform]
      } build failed${userError ? ':' : ''}`
    );
    if (userError) {
      printUserError(userError, build);
    }
    return;
  }
  if ([BuildStatus.Canceled, BuildStatus.PendingCancel].includes(build.status)) {
    Log.addNewLineIfNone();
    Log.error(
      `${appPlatformEmojis[build.platform]} ${
        appPlatformDisplayNames[build.platform]
      } build was canceled`
    );
    return;
  }

  if (build.distribution === DistributionType.Internal) {
    Log.addNewLineIfNone();
    const logsUrl = getBuildLogsUrl(build);
    // It's tricky to install the .apk file directly on Android so let's fallback
    // to the build details page and let people press the button to download there
    const qrcodeUrl =
      build.platform === AppPlatform.Ios ? getInternalDistributionInstallUrl(build) : logsUrl;
    qrcodeTerminal.generate(qrcodeUrl, { small: true }, code => {
      Log.log(`${indentString(code, 2)}\n`);
    });
    Log.log(
      `${appPlatformEmojis[build.platform]} Open this link on your ${
        appPlatformDisplayNames[build.platform]
      } devices (or scan the QR code) to install the app:`
    );
    Log.log(`${link(logsUrl)}`);
  } else {
    // TODO: it looks like buildUrl could possibly be undefined, based on the code below.
    // we should account for this case better if it is possible
    const url = build.artifacts?.buildUrl;
    if (url) {
      Log.addNewLineIfNone();
      Log.log(
        `${appPlatformEmojis[build.platform]} ${appPlatformDisplayNames[build.platform]} app:`
      );
      Log.log(link(url));
    }
  }
}

export function printDeprecationWarnings(deprecationInfo?: EasBuildDeprecationInfo | null): void {
  if (!deprecationInfo) {
    return;
  }
  if (deprecationInfo.type === EasBuildDeprecationInfoType.Internal) {
    Log.warn('This command is using API that soon will be deprecated. Upgrade EAS CLI.');
    Log.warn("Changes won't affect your project config.");
    Log.warn(deprecationInfo.message);
  } else if (deprecationInfo.type === EasBuildDeprecationInfoType.UserFacing) {
    Log.warn('This command is using API that soon will be deprecated.');
    Log.warn(deprecationInfo.message);
  } else {
    Log.warn('An unexpected warning was encountered. Report it as a bug:');
    Log.warn(deprecationInfo);
  }
}

export function printUserError(error: BuildError, build: BuildFragment): void {
  const maybeErrorMessageOverride = maybeGetErrorMessageOverride(error, build);
  if (maybeErrorMessageOverride) {
    Log.error(maybeErrorMessageOverride);
  } else {
    Log.error(error.message);
    if (error.docsUrl) {
      Log.error(learnMore(error.docsUrl, { dim: false }));
    }
  }
}

function maybeGetErrorMessageOverride(error: BuildError, build: BuildFragment): string | null {
  if (!(error.errorCode in errorCodeToErrorMessageOverride)) {
    return null;
  }

  return errorCodeToErrorMessageOverride[error.errorCode](build);
}
