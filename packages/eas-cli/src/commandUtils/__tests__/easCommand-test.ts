import { flushAsync, initAsync, logEvent } from '../../analytics';
import { jester as mockJester } from '../../credentials/__tests__/fixtures-constants';
import { ensureLoggedInAsync } from '../../user/actions';
import EasCommand from '../easCommand';
import TestEasCommand from './TestEasCommand';

describe(EasCommand.name, () => {
  beforeAll(() => {
    jest.mock('../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));
    jest.mock('../../analytics', () => {
      const { AnalyticsEvent } = jest.requireActual('../../analytics');
      return {
        AnalyticsEvent,
        logEvent: jest.fn(),
        initAsync: jest.fn(),
        flushAsync: jest.fn(),
      };
    });
  });

  afterEach(() => {
    (ensureLoggedInAsync as jest.Mock).mockClear();
    (initAsync as jest.Mock).mockClear();
    (flushAsync as jest.Mock).mockClear();
    (logEvent as jest.Mock).mockClear();
  });

  describe('without exceptions', () => {
    it('ensures the user is logged in', async () => {
      await TestEasCommand.run();

      expect(ensureLoggedInAsync).toHaveReturnedWith(mockJester);
    });

    it('initializes analytics', async () => {
      await TestEasCommand.run();

      expect(initAsync).toHaveBeenCalled();
    });

    it('flushes analytics', async () => {
      await TestEasCommand.run();

      expect(flushAsync).toHaveBeenCalled();
    });

    it('logs events', async () => {
      await TestEasCommand.run();

      expect(logEvent).toHaveBeenCalledWith('action', {
        action: `eas ${TestEasCommand.id}`,
      });
    });
  });

  describe('after exceptions', () => {
    it('flushes analytics', async () => {
      try {
        await TestEasCommand.run().then(_ => {
          throw new Error('foo');
        });
      } catch (error) {}

      expect(flushAsync).toHaveBeenCalled();
    });
  });
});
