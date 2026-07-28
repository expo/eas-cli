import { type bunyan } from '@expo/logger';

import { Sentry } from '../../../sentry';
import { stopAgentDeviceEventCollectionSafelyAsync } from '../startAgentDeviceRemoteSession';

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
