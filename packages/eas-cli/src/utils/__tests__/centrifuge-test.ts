import { Centrifuge } from 'centrifuge';

import { createRealtimeLogsClient } from '../centrifuge';

jest.mock('centrifuge');

describe(createRealtimeLogsClient, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns null instead of throwing when the connection cannot be created', () => {
    jest.mocked(Centrifuge).mockImplementationOnce(() => {
      throw new Error('unsupported url scheme');
    });

    expect(createRealtimeLogsClient({} as any)).toBeNull();
  });

  it('connects and returns a client when the connection can be created', () => {
    expect(createRealtimeLogsClient({} as any)).not.toBeNull();

    const centrifuge = jest.mocked(Centrifuge).mock.instances[0];
    expect(jest.mocked(centrifuge.connect)).toHaveBeenCalled();
  });
});
