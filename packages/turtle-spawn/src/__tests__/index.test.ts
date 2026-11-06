import spawnAsync from '@expo/spawn-async';
import { pipeSpawnOutput } from '@expo/logger';

import spawn from '../index';

jest.mock('@expo/spawn-async', () => jest.fn(() => ({ child: {} })));
jest.mock('@expo/logger', () => ({
  pipeSpawnOutput: jest.fn(),
}));

describe('spawn', () => {
  it('defaults stdio to pipe when a logger is provided', () => {
    const logger = {} as any;

    void spawn('echo', ['hello'], { logger });

    expect(spawnAsync).toHaveBeenCalledWith('echo', ['hello'], { stdio: 'pipe' });
    expect(pipeSpawnOutput).toHaveBeenCalledWith(logger, {}, { stdio: 'pipe' });
  });

  it('preserves explicit stdio when a logger is provided', () => {
    const logger = {} as any;
    const stdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];

    void spawn('echo', ['hello'], { logger, stdio });

    expect(spawnAsync).toHaveBeenCalledWith('echo', ['hello'], { stdio });
    expect(pipeSpawnOutput).toHaveBeenCalledWith(logger, {}, { stdio });
  });
});
