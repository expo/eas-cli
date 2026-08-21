import fs from 'node:fs';

import { turtleFetch } from '../../../utils/turtleFetch';
import { startAppiumEventCollectionAsync } from '../appiumEvents';
import { startDeviceRunSessionEventCollectionAsync } from '../deviceRunSessionEvents';

jest.mock('../../../utils/turtleFetch');
jest.mock('../deviceRunSessionEvents', () => ({
  startDeviceRunSessionEventCollectionAsync: jest.fn(async () => ({
    getLastEventObservedAt: () => undefined,
    stopAsync: async () => undefined,
  })),
}));

describe(startAppiumEventCollectionAsync, () => {
  it('writes new Appium Event Timings commands to a normal event file', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(response({ value: [{ id: 'appium-session-id' }] }))
      .mockResolvedValueOnce(
        response({
          value: {
            commands: [
              { cmd: 'getOrientation', startTime: 1_786_693_000_000, endTime: 1_786_693_000_025 },
              { cmd: 'getLogEvents', startTime: 1_786_693_000_026, endTime: 1_786_693_000_027 },
            ],
          },
        })
      )
      .mockResolvedValueOnce(response({ value: [] }));

    const collection = await startAppiumEventCollectionAsync({
      ctx: {} as never,
      deviceRunSessionId: 'device-session-id',
      appiumUrl: 'http://127.0.0.1:4723/',
      logger: { warn: jest.fn() } as never,
      pollIntervalMs: 60_000,
    });
    const source = jest.mocked(startDeviceRunSessionEventCollectionAsync).mock.calls[0][0].source;
    const [eventFile] = await source.findEventFilesAsync();
    let contents = '';
    await waitForAsync(async () => {
      contents = await fs.promises.readFile(eventFile, 'utf8');
      expect(contents).toContain('getOrientation');
    });
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(
      source.parseLine({
        line,
        sourceKey: source.sourceKeyForFile(eventFile),
        sequenceNumber: 1,
        deviceRunSessionId: 'device-session-id',
      })
    ).toMatchObject({
      event: {
        producer: 'appium',
        type: 'operation.completed',
        durationMs: 25,
        summary: 'getOrientation',
      },
    });

    // Appium 3 removed GET /sessions; session discovery must use /appium/sessions.
    expect(turtleFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4723/appium/sessions',
      'GET',
      expect.anything()
    );
    expect(turtleFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4723/session/appium-session-id/appium/events',
      'POST',
      expect.anything()
    );

    await collection.stopAsync();
  });
});

async function waitForAsync(assertion: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  await assertion();
}

function response(value: unknown): Awaited<ReturnType<typeof turtleFetch>> {
  return { json: async () => value } as never;
}
