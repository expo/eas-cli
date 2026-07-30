import { type bunyan } from '@expo/logger';

import { Sentry } from '../../../sentry';
import {
  stopAgentDeviceArtifactPollingAndDaemonAsync,
  stopAgentDeviceEventCollectionSafelyAsync,
} from '../startAgentDeviceRemoteSession';

jest.mock('../../../sentry');

describe(stopAgentDeviceEventCollectionSafelyAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports an unexpected stop failure without rejecting', async () => {
    const error = new Error('stop failed');
    const logger = { warn: jest.fn() } as unknown as bunyan;

    await expect(
      stopAgentDeviceEventCollectionSafelyAsync({
        eventCollection: { stopAsync: jest.fn().mockRejectedValue(error) },
        deviceRunSessionId: 'session-id',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not finish agent-device session event collection',
      error,
      {
        level: 'warning',
        tags: { phase: 'agent-device-event-collection', operation: 'stop' },
        extras: { deviceRunSessionId: 'session-id' },
      }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'Could not finish agent-device session event collection.'
    );
  });
});

describe(stopAgentDeviceArtifactPollingAndDaemonAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aborts and awaits artifact polling before stopping the daemon', async () => {
    const order: string[] = [];
    const abortController = new AbortController();
    let resolvePolling!: () => void;
    const artifactPollingPromise = new Promise<void>(resolve => {
      resolvePolling = () => {
        order.push('polling');
        resolve();
      };
    });
    const daemonProcess = {
      stopAsync: jest.fn(async () => {
        order.push('daemon');
      }),
    };

    const stoppingPromise = stopAgentDeviceArtifactPollingAndDaemonAsync({
      artifactPollAbortController: abortController,
      artifactPollingPromise,
      daemonProcess,
      deviceRunSessionId: 'session-id',
      logger: { warn: jest.fn() } as unknown as bunyan,
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(daemonProcess.stopAsync).not.toHaveBeenCalled();

    resolvePolling();
    await stoppingPromise;

    expect(order).toEqual(['polling', 'daemon']);
  });

  it('reports a polling failure and still stops the daemon', async () => {
    const error = new Error('polling failed');
    const logger = { warn: jest.fn() } as unknown as bunyan;
    const daemonProcess = { stopAsync: jest.fn().mockResolvedValue(undefined) };

    await expect(
      stopAgentDeviceArtifactPollingAndDaemonAsync({
        artifactPollAbortController: new AbortController(),
        artifactPollingPromise: Promise.reject(error),
        daemonProcess,
        deviceRunSessionId: 'session-id',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not finish agent-device remote session artifact polling',
      error,
      {
        level: 'warning',
        tags: { phase: 'agent-device-artifact-polling', operation: 'stop' },
        extras: { deviceRunSessionId: 'session-id' },
      }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'Could not finish agent-device remote session artifact polling.'
    );
    expect(daemonProcess.stopAsync).toHaveBeenCalledTimes(1);
  });
});
