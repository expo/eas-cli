import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { IosSimulatorRecordingUtils } from '../utils/IosSimulatorRecordingUtils';

export function createStartIosSimulatorRecordingsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_ios_simulator_recordings',
    name: 'Start iOS Simulator recordings',
    __metricsId: 'eas/start_ios_simulator_recordings',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      await IosSimulatorRecordingUtils.startAsync({
        env,
        logger,
      });
    },
  });
}
