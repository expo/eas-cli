import spawn from '@expo/turtle-spawn';
import os from 'node:os';
import path from 'node:path';

import { IosSimulatorUtils } from '../IosSimulatorUtils';
import { retryAsync } from '../retry';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../retry', () => ({
  retryAsync: jest.fn(async fn => await fn(0)),
}));

const mockedSpawn = jest.mocked(spawn);

describe('IosSimulatorUtils', () => {
  beforeEach(() => {
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
  });

  describe(IosSimulatorUtils.waitForReadyAsync, () => {
    it('takes the readiness screenshot into a writable temp file, not /dev/null', async () => {
      await IosSimulatorUtils.waitForReadyAsync({
        udid: 'test-udid' as any,
        env: process.env,
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'xcrun',
        [
          'simctl',
          'io',
          'test-udid',
          'screenshot',
          path.join(os.tmpdir(), 'eas-simulator-readiness.png'),
        ],
        { env: process.env }
      );
    });
  });
});
