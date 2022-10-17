import { AppPlatform, BuildFragment } from '../graphql/generated';
import { RequestedPlatform } from '../platform';
import { downloadAndExtractAppAsync, extractAppFromLocalArchiveAsync } from '../utils/download';
import { runAppOnAndroidSimulatorAsync } from './android/AndroidRunner';
import { runAppOnIosSimulatorAsync } from './ios/iosRunner';

export interface RunArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}

export async function runAsync(
  runArchiveFlags: RunArchiveFlags,
  requestedPlatform: RequestedPlatform,
  build?: BuildFragment
): Promise<void> {
  const actualPlatform = resolveActualSimulatorBuildPlatform(requestedPlatform, build);

  const simulatorBuildPath = await getSimulatorBuildPathAsync(
    actualPlatform,
    runArchiveFlags,
    build
  );

  if (actualPlatform === AppPlatform.Ios) {
    await runAppOnIosSimulatorAsync(simulatorBuildPath);
  } else {
    await runAppOnAndroidSimulatorAsync(simulatorBuildPath);
  }
}

async function getSimulatorBuildPathAsync(
  actualPlatform: AppPlatform,
  runArchiveFlags: RunArchiveFlags,
  build?: BuildFragment
): Promise<string> {
  const appExtension = actualPlatform === AppPlatform.Ios ? 'app' : 'apk';

  if (build) {
    if (!build.artifacts?.applicationArchiveUrl) {
      throw new Error('Build does not have an application archive url');
    }

    return await downloadAndExtractAppAsync(build.artifacts.applicationArchiveUrl, appExtension);
  }

  if (runArchiveFlags.url) {
    return await downloadAndExtractAppAsync(runArchiveFlags.url, appExtension);
  }

  if (runArchiveFlags.path!.includes('.tar.gz')) {
    return await extractAppFromLocalArchiveAsync(runArchiveFlags.path!, appExtension);
  }

  return runArchiveFlags.path!;
}

export function requestedPlatformToGraphqlAppPlatform(
  requestedPlatform: RequestedPlatform
): AppPlatform | undefined {
  switch (requestedPlatform) {
    case RequestedPlatform.Android:
      return AppPlatform.Android;
    case RequestedPlatform.Ios:
      return AppPlatform.Ios;
    case RequestedPlatform.All:
      return undefined;
  }
}

function resolveActualSimulatorBuildPlatform(
  requestedPlatform: RequestedPlatform,
  build?: BuildFragment
): AppPlatform {
  if (build) {
    return build.platform;
  }

  return requestedPlatformToGraphqlAppPlatform(requestedPlatform)!;
}
