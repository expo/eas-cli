import { Workflow } from '@expo/eas-build-job';
import { Errors } from '@oclif/core';
import assert from 'assert';
import semver from 'semver';

import { BuildContext } from '../build/context';
import Log from '../log';
import { confirmAsync } from '../prompts';

const SUPPORTED_EXPO_SDK_VERSIONS = '>= 41.0.0';
assert(semver.validRange(SUPPORTED_EXPO_SDK_VERSIONS), 'Must be a valid version range');

export async function checkExpoSdkIsSupportedAsync(ctx: BuildContext): Promise<void> {
  assert(ctx.workflow === Workflow.MANAGED, 'Must be a managed workflow project');

  if (ctx.exp.sdkVersion && semver.satisfies(ctx.exp.sdkVersion, SUPPORTED_EXPO_SDK_VERSIONS)) {
    return;
  }

  const unsupportedSdkMessage =
    'EAS Build does not officially support building managed project with Expo SDK < 41.';
  if (ctx.nonInteractive) {
    Log.warn(
      `${unsupportedSdkMessage} Proceeding because you are running in non-interactive mode.`
    );
    return;
  }

  const proceed = await confirmAsync({
    message: `${unsupportedSdkMessage} Do you want to proceed?`,
  });
  if (!proceed) {
    Errors.exit(1);
  }
}
