import { Response } from 'node-fetch';

import { Datadog } from '../datadog';
import { turtleFetch } from '../utils/turtleFetch';

jest.mock('../utils/turtleFetch', () => ({
  turtleFetch: jest.fn(),
}));

const turtleFetchMock = jest.mocked(turtleFetch);

describe('Datadog singleton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Datadog.setup({});
  });

  it('POSTs distribution metrics to the turtle build metrics endpoint', () => {
    turtleFetchMock.mockResolvedValueOnce({} as Response);
    const logger = { warn: jest.fn() } as any;

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
      logger,
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
        logger,
      }
    );
  });

  it.each([
    { expoApiV2BaseUrl: null, turtleBuildId: 'build-id', robotAccessToken: 'token-abc' },
    {
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: null,
      robotAccessToken: 'token-abc',
    },
    {
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'build-id',
      robotAccessToken: null,
    },
  ])('is a no-op when setup is incomplete: %p', setupOptions => {
    Datadog.setup(setupOptions);

    Datadog.distribution('eas.build.phase_duration', 1);

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('swallows upload failures', async () => {
    const logger = { warn: jest.fn() } as any;
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
      logger,
    });

    Datadog.distribution('eas.build.phase_duration', 1);
    await Promise.resolve();

    expect(turtleFetchMock).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to report turtle build metric'
    );
  });

  it('swallows synchronous URL construction failures', () => {
    const logger = { warn: jest.fn() } as any;
    Datadog.setup({
      expoApiV2BaseUrl: 'not a url',
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
      logger,
    });

    expect(() => Datadog.distribution('eas.build.phase_duration', 1)).not.toThrow();
    expect(turtleFetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'Invalid URL' }) }),
      'Failed to report turtle build metric'
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
});
