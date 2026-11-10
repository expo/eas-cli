import { UserError } from '@expo/eas-build-job';
import { BuildRuntimePlatform } from '@expo/steps';

import {
  type AndroidEmulatorLogSource,
  AndroidEmulatorLogSourcesSchema,
} from '../../utils/androidEmulatorLogSources';

/**
 * `log_sources` is unprefixed like every other step input, so the platform
 * rule is checked here at runtime, the way `network_capture` is.
 */
export function parseLogSourcesInput(
  value: unknown,
  {
    runtimePlatform,
    fallback,
  }: { runtimePlatform: BuildRuntimePlatform; fallback: readonly AndroidEmulatorLogSource[] }
): readonly AndroidEmulatorLogSource[] {
  if (value === undefined) {
    return fallback;
  }
  const sources = AndroidEmulatorLogSourcesSchema.parse(value);
  if (sources.length > 0 && runtimePlatform === BuildRuntimePlatform.DARWIN) {
    throw new UserError(
      'EAS_LOG_SOURCES_INVALID_INPUT',
      `Input "log_sources" selects Android emulator logs, and this session runs on iOS. Drop "log_sources", or run the session on Android.`
    );
  }
  return sources;
}
