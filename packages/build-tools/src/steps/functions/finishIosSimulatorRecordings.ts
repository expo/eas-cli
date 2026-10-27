import { BuildFunction, BuildRuntimePlatform, BuildStepOutput } from '@expo/steps';

import { IosSimulatorRecordingUtils } from '../utils/IosSimulatorRecordingUtils';

export function createFinishIosSimulatorRecordingsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'finish_ios_simulator_recordings',
    name: 'Finish iOS Simulator recordings',
    __metricsId: 'eas/finish_ios_simulator_recordings',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'recordings_json',
        required: true,
      }),
    ],
    fn: async ({ logger }, { outputs }) => {
      const recordings = await IosSimulatorRecordingUtils.finishAsync({ logger });
      outputs.recordings_json.set(JSON.stringify(recordings));
    },
  });
}
