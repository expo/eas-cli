import type { bunyan } from '@expo/logger';
import { vol } from 'memfs';
import { writeFile } from 'node:fs/promises';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { uploadDeviceRunSessionScreenRecordingsAsync } from '../deviceRunSessionScreenRecordings';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const ctx = {} as CustomBuildContext;
const recording = {
  udid: 'simulator-id',
  deviceName: 'iPhone Duo',
  runtimeDisplayName: 'iOS 27.1',
  directory: '/recordings/recording-id',
};
const manifest = {
  firstFrameWallClock: { unixMs: 1_791_072_000_000, iso8601: '2026-10-04T00:00:00.000Z' },
  width: 1440,
  height: 1200,
  recording: 'recording.mp4',
};

beforeEach(() => {
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset().mockResolvedValue(undefined);
});

it.each([
  {},
  {
    deviceStates: [
      {
        timeMs: 12.5,
        state: {
          width: 1200,
          height: 1440,
          orientation: 'landscape-left',
          screen: 'inner',
          hingeAngle: 90,
          physicalOrientation: 'portrait',
          tableMode: false,
          contentRect: { x: 220, y: 0, width: 1000, height: 1200 },
        },
      },
    ],
    interruptions: [{ reason: 'simulatorReboot', pausedAtSeconds: 1, resumedAtSeconds: 2 }],
    futureField: { label: '서울 🌲' },
  },
])('uploads the complete manifest unchanged beside its video (%j)', async extra => {
  const contents = Buffer.from(JSON.stringify({ ...manifest, ...extra }, null, 2) + '\n');
  vol.fromJSON({
    [recording.directory + '/session.json']: contents.toString(),
    [recording.directory + '/recording.mp4']: 'video',
  });
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_, input) => {
    if (input.kind === 'screen-recording') {
      await writeFile(recording.directory + '/session.json', '{}');
    }
  });

  await expect(
    uploadDeviceRunSessionScreenRecordingsAsync(ctx, {
      logger,
      deviceRunSessionId: 'session-id',
      recordings: [recording],
    })
  ).resolves.toBe(true);

  const inputs = jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mock.calls.map(([, input]) => input);
  expect(inputs.map(input => input.filename)).toEqual(['recording-id.mp4', 'recording-id.json']);
  expect(inputs[1]).toMatchObject({
    deviceRunSessionId: 'session-id',
    artifactId: 'recording-id-metadata',
    kind: 'screen-recording-metadata',
    metadata: {
      __eas_type: 'screen-recording-metadata',
      recordingFilename: 'recording-id.mp4',
      udid: recording.udid,
    },
    size: contents.length,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const chunks: Buffer[] = [];
    for await (const chunk of inputs[1].openStream()) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(contents);
  }
});

it('reports a metadata upload failure while keeping the video and uploading other recordings', async () => {
  const other = { ...recording, directory: '/recordings/other-recording', udid: 'other-device' };
  for (const item of [recording, other]) {
    vol.fromJSON({
      [item.directory + '/session.json']: JSON.stringify(manifest),
      [item.directory + '/recording.mp4']: 'video',
    });
  }
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_, input) => {
    if (input.filename === 'recording-id.json') {
      throw new Error('Storage unavailable');
    }
  });

  await expect(
    uploadDeviceRunSessionScreenRecordingsAsync(ctx, {
      logger,
      deviceRunSessionId: 'session-id',
      recordings: [recording, other],
    })
  ).resolves.toBe(false);

  expect(
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mock.calls.map(([, input]) => input.filename)
  ).toEqual(
    expect.arrayContaining([
      'recording-id.mp4',
      'recording-id.json',
      'other-recording.mp4',
      'other-recording.json',
    ])
  );
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not upload device screen recording metadata',
    expect.any(Error)
  );
  expect(Sentry.capture).not.toHaveBeenCalledWith(
    'Could not upload device screen recording',
    expect.any(Error)
  );
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.any(Error) }),
    `Could not upload screen recording metadata for ${recording.deviceName}.`
  );
});
