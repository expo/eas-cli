import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import { Client } from '@urql/core';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  fetchServeSimTurnArgsAsync,
  isDeviceRunSessionFinalAsync,
  turnIceServersToServeSimArgs,
} from '../remoteDeviceRunSession';

jest.mock('../../../utils/turtleFetch');
jest.mock('../../../sentry');
// The module under test imports the ngrok SDK (a native addon) at the top
// level - mock it so the unit tests don't load the native binary.
jest.mock('@ngrok/ngrok', () => ({ forward: jest.fn() }));

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as bunyan;
}

function createCtxMock(): CustomBuildContext {
  return {
    env: {
      __API_SERVER_URL: 'https://api.expo.test',
    },
    job: {
      secrets: { robotAccessToken: 'robot-token' },
    },
  } as unknown as CustomBuildContext;
}

function createEnvMock(): BuildStepEnv {
  return { DEVICE_RUN_SESSION_ID: 'drs-id' } as unknown as BuildStepEnv;
}

describe(turnIceServersToServeSimArgs, () => {
  it('returns no args for an empty ICE server list', () => {
    expect(turnIceServersToServeSimArgs([])).toEqual([]);
  });

  it('builds --stun-url and --turn-url flags from Cloudflare ICE servers', () => {
    expect(
      turnIceServersToServeSimArgs([
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'user-123',
          credential: 'cred-456',
        },
      ])
    ).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478,stun:stun.cloudflare.com:53',
      '--turn-url',
      'turn:turn.cloudflare.com:3478?transport=udp,turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'user-123',
      '--turn-credential',
      'cred-456',
    ]);
  });

  it('emits only --turn-url flags when no credential-less (STUN) entry is present', () => {
    expect(
      turnIceServersToServeSimArgs([
        {
          urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
          username: 'u',
          credential: 'c',
        },
      ])
    ).toEqual([
      '--turn-url',
      'turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'u',
      '--turn-credential',
      'c',
    ]);
  });

  it('emits only --stun-url when there is no credentialed TURN entry', () => {
    expect(turnIceServersToServeSimArgs([{ urls: ['stun:stun.cloudflare.com:3478'] }])).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478',
    ]);
  });
});

describe(fetchServeSimTurnArgsAsync, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it('requests TURN ICE servers from the device run session endpoint and returns serve-sim args', async () => {
    jest.mocked(turtleFetch).mockResolvedValue({
      json: async () => ({
        data: {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            {
              urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
              username: 'u',
              credential: 'c',
            },
          ],
        },
      }),
    } as unknown as Awaited<ReturnType<typeof turtleFetch>>);

    const args = await fetchServeSimTurnArgsAsync(createCtxMock(), {
      env: createEnvMock(),
      logger: createLoggerMock(),
    });

    expect(args).toEqual([
      '--stun-url',
      'stun:stun.cloudflare.com:3478',
      '--turn-url',
      'turns:turn.cloudflare.com:443?transport=tcp',
      '--turn-username',
      'u',
      '--turn-credential',
      'c',
    ]);
    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      'https://api.expo.test/v2/device-run-sessions/drs-id/turn-ice-servers',
      'POST',
      expect.objectContaining({
        headers: { Authorization: 'Bearer robot-token' },
      })
    );
  });

  it('returns [] and warns when the request fails so serve-sim falls back to P2P/STUN', async () => {
    jest.mocked(turtleFetch).mockRejectedValue(new Error('boom'));
    const logger = createLoggerMock();

    const args = await fetchServeSimTurnArgsAsync(createCtxMock(), {
      env: createEnvMock(),
      logger,
    });

    expect(args).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(jest.mocked(Sentry).capture).toHaveBeenCalled();
  });
});

const DEVICE_RUN_SESSION_ID = 'device-run-session-id';

describe(isDeviceRunSessionFinalAsync, () => {
  let mockQueryFn: jest.Mock;
  let ctx: CustomBuildContext;

  beforeEach(() => {
    mockQueryFn = jest.fn();
    ctx = {
      graphqlClient: {
        query: jest.fn().mockReturnValue({ toPromise: mockQueryFn }),
      } as unknown as Client,
    } as CustomBuildContext;
  });

  function mockStatusResponse(status: string): void {
    mockQueryFn.mockResolvedValue({
      data: { deviceRunSessions: { byId: { id: DEVICE_RUN_SESSION_ID, status } } },
    });
  }

  it.each(['STOPPED', 'ERRORED'])('returns true for final status %s', async status => {
    mockStatusResponse(status);

    await expect(
      isDeviceRunSessionFinalAsync({
        ctx,
        deviceRunSessionId: DEVICE_RUN_SESSION_ID,
        logger: createMockLogger(),
      })
    ).resolves.toBe(true);
    expect(ctx.graphqlClient.query).toHaveBeenCalledWith(expect.anything(), {
      deviceRunSessionId: DEVICE_RUN_SESSION_ID,
    });
  });

  it.each(['NEW', 'IN_PROGRESS'])('returns false for non-final status %s', async status => {
    mockStatusResponse(status);

    await expect(
      isDeviceRunSessionFinalAsync({
        ctx,
        deviceRunSessionId: DEVICE_RUN_SESSION_ID,
        logger: createMockLogger(),
      })
    ).resolves.toBe(false);
  });

  it('returns false and logs a warning when the query reports an error', async () => {
    mockQueryFn.mockResolvedValue({ error: { message: 'transient API error' } });
    const logger = createMockLogger();

    await expect(
      isDeviceRunSessionFinalAsync({
        ctx,
        deviceRunSessionId: DEVICE_RUN_SESSION_ID,
        logger,
      })
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('transient API error'));
  });

  it('returns false and logs a warning when the query throws', async () => {
    mockQueryFn.mockRejectedValue(new Error('network down'));
    const logger = createMockLogger();

    await expect(
      isDeviceRunSessionFinalAsync({
        ctx,
        deviceRunSessionId: DEVICE_RUN_SESSION_ID,
        logger,
      })
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns false when the response is missing the session', async () => {
    mockQueryFn.mockResolvedValue({ data: { deviceRunSessions: { byId: null } } });

    await expect(
      isDeviceRunSessionFinalAsync({
        ctx,
        deviceRunSessionId: DEVICE_RUN_SESSION_ID,
        logger: createMockLogger(),
      })
    ).resolves.toBe(false);
  });
});
