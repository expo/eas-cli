import assert from 'assert';

import { Ios } from '@expo/eas-build-job';
import { IOSConfig } from '@expo/config-plugins';

import { BuildContext } from '../context';

export function resolveScheme(ctx: BuildContext<Ios.Job>): string {
  if (ctx.job.scheme) {
    return ctx.job.scheme;
  }
  const schemes = IOSConfig.BuildScheme.getSchemesFromXcodeproj(
    ctx.getReactNativeProjectDirectory()
  );
  assert(schemes.length === 1, 'Ejected project should have exactly one scheme');
  return schemes[0];
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
