import { EventEmitter } from 'events';

import spawnAsync from '@expo/spawn-async';
import { ExpoRunFormatter } from '@expo/xcpretty';
import fg from 'fast-glob';

import { createMockLogger } from '../../../../__tests__/utils/logger';
import { Sentry } from '../../../../sentry';
import { XcodeBuildLogger } from '../xcpretty';

jest.mock('@expo/spawn-async');
jest.mock('@expo/xcpretty');
jest.mock('fast-glob');
jest.mock('../../../../sentry', () => ({
  Sentry: {
    setup: jest.fn(),
    capture: jest.fn(),
    flush: jest.fn(),
  },
}));

describe(XcodeBuildLogger, () => {
  let stdout: EventEmitter;
  let formatter: { pipe: jest.Mock; getBuildSummary: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    stdout = new EventEmitter();
    const spawnPromise = Object.assign(new Promise(() => {}), {
      child: { stdout, kill: jest.fn() },
    });
    jest.mocked(spawnAsync).mockReturnValue(spawnPromise as any);

    formatter = {
      pipe: jest.fn(),
      getBuildSummary: jest.fn().mockReturnValue('summary'),
    };
    jest.mocked(ExpoRunFormatter.create).mockReturnValue(formatter as any);

    jest.mocked(fg).mockResolvedValue(['build.log'] as any);
  });

  async function startWatchingAsync(logger: ReturnType<typeof createMockLogger>): Promise<void> {
    const buildLogger = new XcodeBuildLogger(logger, '/project');
    await buildLogger.watchLogFiles('/logs');
  }

  it('logs formatted lines', async () => {
    const logger = createMockLogger();
    await startWatchingAsync(logger);

    formatter.pipe.mockReturnValue(['line1', 'line2']);
    stdout.emit('data', 'raw xcodebuild output');

    expect(formatter.pipe).toHaveBeenCalledWith('raw xcodebuild output');
    expect(logger.info).toHaveBeenCalledWith('line1');
    expect(logger.info).toHaveBeenCalledWith('line2');
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('falls back to raw logs when the formatter throws', async () => {
    const logger = createMockLogger();
    await startWatchingAsync(logger);

    formatter.pipe.mockImplementation(() => {
      throw new RangeError('Invalid array length');
    });
    stdout.emit('data', 'offending output');

    expect(logger.info).toHaveBeenCalledWith('offending output');
  });

  it('reports the formatter error to Sentry only once', async () => {
    const logger = createMockLogger();
    await startWatchingAsync(logger);

    const error = new RangeError('Invalid array length');
    formatter.pipe.mockImplementation(() => {
      throw error;
    });
    stdout.emit('data', 'offending output');
    stdout.emit('data', 'more offending output');

    expect(logger.info).toHaveBeenCalledWith('offending output');
    expect(logger.info).toHaveBeenCalledWith('more offending output');
    expect(Sentry.capture).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).toHaveBeenCalledWith(
      'xcpretty formatter failed to parse xcodebuild logs',
      error,
      { extras: { data: 'offending output' } }
    );
  });
});
