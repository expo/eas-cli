import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  parseDeviceScreenRecordings,
  uploadDeviceRunSessionScreenRecordingsAsync,
} from '../utils/deviceRunSessionScreenRecordings';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';

export function createUploadDeviceRunSessionScreenRecordingsBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'upload_device_run_session_screen_recordings',
    name: 'Upload device run session screen recordings',
    __metricsId: 'eas/upload_device_run_session_screen_recordings',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN, BuildRuntimePlatform.LINUX],
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'recordings_json',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    ],
    fn: async ({ logger }, { env, inputs }) => {
      const recordings = parseDeviceScreenRecordings(inputs.recordings_json.value ?? []);
      if (recordings.length === 0) {
        logger.info('No device screen recordings found; skipping uploads.');
        return;
      }
      await uploadDeviceRunSessionScreenRecordingsAsync(ctx, {
        logger,
        deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
        recordings,
      });
    },
  });
}
