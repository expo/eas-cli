import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';

import { killProcessGroup } from '../../utils/processes';

export async function preparePreinstalledWdaAsync({
  runtimeIdentifier,
  appiumHome,
  appiumBinPath,
  appiumEnv,
  logger,
}: {
  runtimeIdentifier: string | undefined;
  appiumHome: string;
  appiumBinPath: string;
  appiumEnv: BuildStepEnv;
  logger: bunyan;
}): Promise<Record<string, unknown>> {
  const iosMajor = /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+)(?:-|$)/.exec(
    runtimeIdentifier ?? ''
  )?.[1];
  // WDA v13+ supports preinstalled launch on iOS 17 and newer.
  if (!iosMajor || Number(iosMajor) < 17) {
    return {};
  }

  const outdir = path.join(appiumHome, 'preinstalled-wda');
  const runner = path.join(outdir, 'WebDriverAgentRunner-Runner.app');
  try {
    // The driver selects the release matching its installed WDA and the host architecture.
    // Keep the Simulator runner intact; removing its XCTest frameworks breaks launch.
    const download = spawn(
      appiumBinPath,
      [
        'driver',
        'run',
        'xcuitest',
        'download-wda',
        '--',
        '--outdir',
        outdir,
        '--platform',
        'iOS',
        '--kind',
        'sim',
      ],
      { env: appiumEnv, logger, detached: true }
    );
    // Appium's downloader inherits its pipes; killing only Appium leaves spawn's
    // close event pending. Kill the owned group, then await close before cleanup.
    const timeout = setTimeout(() => killProcessGroup(download.child, 'SIGKILL'), 60_000);
    try {
      await download;
    } finally {
      clearTimeout(timeout);
    }
    if (!(await fs.promises.stat(runner)).isDirectory()) {
      throw new Error('The downloaded WebDriverAgent runner is not an app directory.');
    }
    logger.info('Using preinstalled WebDriverAgent to avoid xcodebuild during session creation.');
    return {
      'appium:usePreinstalledWDA': true,
      'appium:prebuiltWDAPath': runner,
    };
  } catch (err) {
    await fs.promises.rm(outdir, { recursive: true, force: true });
    logger.warn(
      { err },
      'Could not prepare preinstalled WebDriverAgent; using the default xcodebuild startup.'
    );
    return {};
  }
}
