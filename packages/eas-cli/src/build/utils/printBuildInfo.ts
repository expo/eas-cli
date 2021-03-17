import { errors } from '@expo/eas-build-job';
import assert from 'assert';
import chalk from 'chalk';

import Log, { learnMore } from '../../log';
import { platformDisplayNames, platformEmojis } from '../constants';
import { Build } from '../types';
import { getBuildLogsUrl } from './url';

export interface DeprecationInfo {
  type: 'user-facing' | 'internal';
  message: string;
}

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
      Log.log(`${platformDisplayNames[platform]} build details: ${chalk.underline(logsUrl)}`);
    });
  }
}

export function printBuildResults(accountName: string, builds: (Build | null)[]): void {
  Log.newLine();
  if (builds.length === 1) {
    const [build] = builds;
    assert(build, 'Build should be defined');
    printBuildResult(accountName, build);
  } else {
    (builds.filter(i => i) as Build[]).forEach(build => printBuildResult(accountName, build));
  }
}

function printBuildResult(accountName: string, build: Build): void {
  Log.addNewLineIfNone();
  if (build.status === 'errored') {
    const userError = build.error;
    Log.error(
      `${platformEmojis[build.platform]} ${platformDisplayNames[build.platform]} build failed${
        userError ? ':' : ''
      }`
    );
    if (userError) {
      printUserError(userError);
    }
    return;
  }
  if (build.status === 'canceled') {
    Log.error(
      `${platformEmojis[build.platform]} ${platformDisplayNames[build.platform]} was canceled`
    );
    return;
  }

  if (build.metadata?.distribution === 'internal') {
    const logsUrl = getBuildLogsUrl({
      buildId: build.id,
      account: accountName,
    });
    Log.log(
      `${platformEmojis[build.platform]} Open this link on your ${
        platformDisplayNames[build.platform]
      } devices to install the app:`
    );
    Log.log(`${chalk.underline(logsUrl)}`);
  } else {
    // TODO: it looks like buildUrl could possibly be undefined, based on the code below.
    // we should account for this case better if it is possible
    const url = build.artifacts?.buildUrl ?? '';
    Log.log(`${platformEmojis[build.platform]} ${platformDisplayNames[build.platform]} app:`);
    Log.log(`${chalk.underline(url)}`);
  }
}

export function printDeprecationWarnings(deprecationInfo?: DeprecationInfo): void {
  if (!deprecationInfo) {
    return;
  }
  if (deprecationInfo.type === 'internal') {
    Log.warn('This command is using API that soon will be deprecated, please update eas-cli.');
    Log.warn("Changes won't affect your project config.");
    Log.warn(deprecationInfo.message);
  } else if (deprecationInfo.type === 'user-facing') {
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

export function printUserError(error: errors.ExternalUserError): void {
  Log.error(error.message);
  if (error.docsUrl) {
    Log.error(learnMore(error.docsUrl, { dim: false }));
  }
}
