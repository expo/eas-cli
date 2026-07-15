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
  beforeEach(() => {
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockReset()
      .mockImplementation(async (_ctx, { stream }) => {
        await new Promise<void>((resolve, reject) => {
          stream.once('end', resolve);
          stream.once('error', reject);
          stream.resume();
        });
      });
  });

  it('uploads simulator device metadata', async () => {
    const recordingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ios-recording-test-'));
    const recordingPath = path.join(recordingDirectory, 'recording.mp4');
    await fs.writeFile(recordingPath, 'recording');
    await fs.writeFile(
      path.join(recordingDirectory, 'session.json'),
      JSON.stringify({
        recording: path.basename(recordingPath),
        firstFrameWallClock: { iso8601: '2026-07-10T10:00:00.000Z' },
        width: 1179,
        height: 2556,
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
          name: 'iPhone 16 screen recording (started at Jul 10, 2026, 10:00:00.000 UTC)',
          metadata: {
            __eas_screen_recording: '1',
            udid: 'simulator-udid',
            deviceName: 'iPhone 16',
            runtimeDisplayName: 'iOS 18.6',
            firstFrameAt: '2026-07-10T10:00:00.000Z',
            width: 1179,
            height: 2556,
          },
        })
      );
    } finally {
      await fs.rm(recordingDirectory, { recursive: true, force: true });
    }
  });

  it('uses unique names for recordings from the same simulator', async () => {
    const recordingDirectories = await Promise.all(
      ['2026-07-10T10:00:00.000Z', '2026-07-10T10:05:00.000Z'].map(async firstFrameAt => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ios-recording-test-'));
        await fs.writeFile(path.join(directory, 'recording.mp4'), 'recording');
        await fs.writeFile(
          path.join(directory, 'session.json'),
          JSON.stringify({
            recording: 'recording.mp4',
            firstFrameWallClock: { iso8601: firstFrameAt },
            width: 1179,
            height: 2556,
          })
        );
        return directory;
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
          recordings_json: recordingDirectories.map(directory => ({
            udid: 'simulator-udid',
            deviceName: 'iPhone 16',
            runtimeDisplayName: 'iOS 18.6',
            directory,
          })),
        },
      });

      await buildStep.executeAsync();

      const names = jest
        .mocked(uploadDeviceRunSessionArtifactAsync)
        .mock.calls.map(([, options]) => options.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'iPhone 16 screen recording (started at Jul 10, 2026, 10:00:00.000 UTC)',
          'iPhone 16 screen recording (started at Jul 10, 2026, 10:05:00.000 UTC)',
        ])
      );
      expect(new Set(names).size).toBe(2);
    } finally {
      await Promise.all(
        recordingDirectories.map(directory => fs.rm(directory, { recursive: true, force: true }))
      );
    }
  });
});
