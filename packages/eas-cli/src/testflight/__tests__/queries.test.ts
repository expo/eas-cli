import { App } from '@expo/apple-utils';

import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { listAndRenderTestFlightCrashesAsync } from '../queries';

jest.mock('../../log');
jest.mock('../../prompts', () => ({
  selectAsync: jest.fn(),
  confirmAsync: jest.fn(),
}));

function createApp(count: number): App {
  const submissions = Array.from({ length: count }).map((_, index) => ({
    id: `crash-${index + 1}`,
    attributes: {
      createdDate: '2026-07-20T10:00:00.000Z',
      comment: null,
      deviceModel: 'iPhone15,2',
      osVersion: '18.2',
    },
  }));
  return {
    attributes: { bundleId: 'com.example.app' },
    getBetaFeedbackCrashSubmissionsAsync: jest.fn().mockResolvedValue(submissions),
  } as unknown as App;
}

function loggedOutput(): string {
  return jest
    .mocked(Log.log)
    .mock.calls.map(call => String(call[0]))
    .join('\n');
}

describe(listAndRenderTestFlightCrashesAsync, () => {
  beforeEach(() => {
    jest.mocked(Log.log).mockClear();
    jest.mocked(confirmAsync).mockReset();
  });

  it('numbers items by their absolute position across interactive pages', async () => {
    // Accept the first "Load more?" prompt, decline the second.
    jest.mocked(confirmAsync).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await listAndRenderTestFlightCrashesAsync(createApp(6), {
      limit: 2,
      offset: 0,
      json: false,
      nonInteractive: false,
    });

    const output = loggedOutput();
    expect(output).toContain('1. Crash crash-1');
    expect(output).toContain('2. Crash crash-2');
    expect(output).toContain('3. Crash crash-3');
    expect(output).toContain('4. Crash crash-4');
    expect(output).not.toContain('5. Crash');
    expect(jest.mocked(confirmAsync)).toHaveBeenCalledTimes(2);
  });

  it('stops prompting once the last page is rendered', async () => {
    await listAndRenderTestFlightCrashesAsync(createApp(2), {
      limit: 2,
      offset: 0,
      json: false,
      nonInteractive: false,
    });

    expect(loggedOutput()).toContain('2. Crash crash-2');
    expect(jest.mocked(confirmAsync)).not.toHaveBeenCalled();
  });

  it('honors offset when numbering a single non-interactive page', async () => {
    await listAndRenderTestFlightCrashesAsync(createApp(6), {
      limit: 2,
      offset: 4,
      json: false,
      nonInteractive: true,
    });

    const output = loggedOutput();
    expect(output).toContain('5. Crash crash-5');
    expect(output).toContain('6. Crash crash-6');
    expect(output).not.toContain('1. Crash');
    expect(jest.mocked(confirmAsync)).not.toHaveBeenCalled();
  });

  it('hints at remaining items when non-interactive', async () => {
    await listAndRenderTestFlightCrashesAsync(createApp(6), {
      limit: 2,
      offset: 0,
      json: false,
      nonInteractive: true,
    });

    expect(loggedOutput()).toContain(
      'Showing 2 of 6 crashes. Use --offset and --limit to see more.'
    );
  });

  it('reports an empty collection', async () => {
    await listAndRenderTestFlightCrashesAsync(createApp(0), {
      limit: 2,
      offset: 0,
      json: false,
      nonInteractive: true,
    });

    expect(loggedOutput()).toContain('No TestFlight crashes have been reported for');
  });
});
