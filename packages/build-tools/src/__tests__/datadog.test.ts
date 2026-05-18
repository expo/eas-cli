import { Response } from 'node-fetch';

import { Datadog } from '../datadog';
import { Sentry } from '../sentry';
import { turtleFetch } from '../utils/turtleFetch';

jest.mock('../sentry', () => ({
  Sentry: {
    capture: jest.fn(),
  },
}));
jest.mock('../utils/turtleFetch', () => ({
  turtleFetch: jest.fn(),
}));

const turtleFetchMock = jest.mocked(turtleFetch);
const sentryCaptureMock = jest.mocked(Sentry.capture);

describe('Datadog singleton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Datadog.setup(null);
  });

  it('POSTs distribution metrics to the turtle build metrics endpoint', () => {
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
    });

    Datadog.distribution('eas.build.phase_duration', 1234, {
      build_phase: 'install_dependencies',
      platform: 'ios',
      result: 'success',
    });

    expect(turtleFetchMock).toHaveBeenCalledWith(
      'https://api.expo.test/v2/turtle-builds/build-id/metrics',
      'POST',
      {
        json: {
          metrics: [
            {
              name: 'eas.build.phase_duration',
              type: 'distribution',
              value: 1234,
              tags: {
                build_phase: 'install_dependencies',
                platform: 'ios',
                result: 'success',
              },
            },
          ],
        },
        headers: { Authorization: 'Bearer token-abc' },
        retries: 2,
      }
    );
  });

  it('is a no-op when setup is null', () => {
    Datadog.setup(null);

    Datadog.distribution('eas.build.phase_duration', 1);

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('swallows upload failures', async () => {
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
    });

    Datadog.distribution('eas.build.phase_duration', 1);
    await flushPromises();

    expect(turtleFetchMock).toHaveBeenCalled();
    expect(sentryCaptureMock).toHaveBeenCalledWith(
      'Failed to report turtle build metric',
      expect.any(Error),
      expect.objectContaining({
        extras: {
          metrics: [{ name: 'eas.build.phase_duration', type: 'distribution', value: 1 }],
        },
      })
    );
  });

  it('uses the latest setup options', () => {
    turtleFetchMock.mockResolvedValue({} as Response);

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'first-build-id',
      robotAccessToken: 'first-token',
    });
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'second-build-id',
      robotAccessToken: 'second-token',
    });

    Datadog.distribution('eas.build.phase_duration', 1);

    expect(turtleFetchMock).toHaveBeenCalledWith(
      'https://api.expo.test/v2/turtle-builds/second-build-id/metrics',
      'POST',
      expect.objectContaining({
        headers: { Authorization: 'Bearer second-token' },
      })
    );
  });

  it('flushes pending metric uploads', async () => {
    let resolveUpload!: (response: Response) => void;
    turtleFetchMock.mockReturnValueOnce(
      new Promise<Response>(resolve => {
        resolveUpload = resolve;
      })
    );
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
    });

    let flushed = false;
    Datadog.distribution('eas.build.phase_duration', 1);
    const flushPromise = Datadog.flushAsync().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    resolveUpload({} as Response);
    await flushPromise;

    expect(flushed).toBe(true);
  });
});

async function flushPromises(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}
