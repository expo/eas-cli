import { AppPlatform, BuildFragment } from '../graphql/generated';
import { RequestedPlatform } from '../platform';
import { downloadAndExtractAppAsync } from '../utils/download';
import { runAppOnIosSimulatorAsync } from './ios/IosRunner';

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
  const simulatorBuildPath = await getSimulatorBuildPathAsync(runArchiveFlags, build);

  const actualPlatform = resolveActualSimulatorBuildPlatform(requestedPlatform, build);

  if (actualPlatform === AppPlatform.Ios) {
    await runAppOnIosSimulatorAsync(simulatorBuildPath);
  }
}

async function getSimulatorBuildPathAsync(
  runArchiveFlags: RunArchiveFlags,
  build?: BuildFragment
): Promise<string> {
  if (build) {
    if (!build.artifacts?.applicationArchiveUrl) {
      throw new Error('Build does not have an application archive url');
    }

    return await downloadAndExtractAppAsync(build.artifacts.applicationArchiveUrl);
  }

  if (runArchiveFlags.url) {
    return await downloadAndExtractAppAsync(runArchiveFlags.url);
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
