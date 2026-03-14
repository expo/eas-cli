import { IOSConfig } from '@expo/config-plugins';
import { Ios } from '@expo/eas-build-job';
import { asyncResult } from '@expo/results';
import assert from 'assert';

import { assertNoPodSchemeNameCollision } from './schemeCollision';
import { BuildContext } from '../context';

export async function resolveScheme(ctx: BuildContext<Ios.Job>): Promise<string> {
  const projectDir = ctx.getReactNativeProjectDirectory();
  if (ctx.job.scheme) {
    await warnIfPodSchemeNameCollisionAsync({
      ctx,
      projectDir,
      buildScheme: ctx.job.scheme,
    });
    return ctx.job.scheme;
  }
  const schemes = IOSConfig.BuildScheme.getSchemesFromXcodeproj(projectDir);
  assert(schemes.length === 1, 'Ejected project should have exactly one scheme');
  await warnIfPodSchemeNameCollisionAsync({
    ctx,
    projectDir,
    buildScheme: schemes[0],
  });
  return schemes[0];
}

async function warnIfPodSchemeNameCollisionAsync({
  ctx,
  projectDir,
  buildScheme,
}: {
  ctx: BuildContext<Ios.Job>;
  projectDir: string;
  buildScheme: string;
}): Promise<void> {
  const collisionCheckResult = await asyncResult(
    (async () => assertNoPodSchemeNameCollision({ projectDir, buildScheme }))()
  );
  if (!collisionCheckResult.ok) {
    ctx.logger.warn(
      { err: collisionCheckResult.reason },
      `Detected an iOS scheme name collision for "${buildScheme}". ` +
        'Xcode may select a Pods scheme instead of the app scheme. Continuing with the selected scheme.'
    );
    ctx.markBuildPhaseHasWarnings();
  }
}

export function resolveArtifactPath(ctx: BuildContext<Ios.Job>): string {
  if (ctx.job.applicationArchivePath) {
    return ctx.job.applicationArchivePath;
  } else if (ctx.job.simulator) {
    return 'ios/build/Build/Products/*simulator/*.app';
  } else {
    return 'ios/build/*.ipa';
  }
}

export function resolveBuildConfiguration(ctx: BuildContext<Ios.Job>): string {
  if (ctx.job.buildConfiguration) {
    return ctx.job.buildConfiguration;
  } else if (ctx.job.developmentClient) {
    return 'Debug';
  } else {
    return 'Release';
  }
}
