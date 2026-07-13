import { BuildRuntimePlatform } from '@expo/steps';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../../utils/deviceRunSessionArtifacts';
import { createUploadDeviceRunSessionScreenRecordingsBuildFunction } from '../uploadDeviceRunSessionScreenRecordings';

jest.mock('../../utils/deviceRunSessionArtifacts', () => ({
  uploadDeviceRunSessionArtifactAsync: jest.fn(),
}));

describe(createUploadDeviceRunSessionScreenRecordingsBuildFunction, () => {
  it('uploads simulator device metadata', async () => {
    const recordingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ios-recording-test-'));
    const recordingPath = path.join(recordingDirectory, 'recording.mp4');
    await fs.writeFile(recordingPath, 'recording');
    await fs.writeFile(
      path.join(recordingDirectory, 'session.json'),
      JSON.stringify({
        recording: path.basename(recordingPath),
        firstFrameWallClock: { iso8601: '2026-07-10T10:00:00.000Z' },
      })
    );

    try {
      const globalContext = createGlobalContextMock({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
      });
      const buildStep = createUploadDeviceRunSessionScreenRecordingsBuildFunction(
        {} as CustomBuildContext
      ).createBuildStepFromFunctionCall(globalContext, {
        env: { DEVICE_RUN_SESSION_ID: 'device-run-session-id' },
        callInputs: {
          recordings_json: [
            {
              udid: 'simulator-udid',
              deviceName: 'iPhone 16',
              runtimeDisplayName: 'iOS 18.6',
              directory: recordingDirectory,
            },
          ],
        },
      });

      await buildStep.executeAsync();

      expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'iPhone 16 screen recording',
          metadata: {
            __eas_screen_recording: '1',
            udid: 'simulator-udid',
            deviceName: 'iPhone 16',
            runtimeDisplayName: 'iOS 18.6',
            firstFrameAt: '2026-07-10T10:00:00.000Z',
          },
        })
      );
    } finally {
      await fs.rm(recordingDirectory, { recursive: true, force: true });
    }
  });
});
