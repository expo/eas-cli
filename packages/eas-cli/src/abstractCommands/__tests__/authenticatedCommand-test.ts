import { flushAsync, initAsync, logEvent } from '../../analytics';
import { jester as mockJester } from '../../credentials/__tests__/fixtures-constants';
import { ensureLoggedInAsync } from '../../user/actions';
import AuthenticatedCommand from '../authenticatedCommand';
import TestAuthenticatedCommand from './TestAuthenticatedCommand';

describe(AuthenticatedCommand.name, () => {
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
      await TestAuthenticatedCommand.run();

      expect(ensureLoggedInAsync).toHaveReturnedWith(mockJester);
    });

    it('initializes analytics', async () => {
      await TestAuthenticatedCommand.run();

      expect(initAsync).toHaveBeenCalled();
    });

    it('flushes analytics', async () => {
      await TestAuthenticatedCommand.run();

      expect(flushAsync).toHaveBeenCalled();
    });

    it('logs events', async () => {
      await TestAuthenticatedCommand.run();

      expect(logEvent).toHaveBeenCalledWith('action', {
        action: `eas ${TestAuthenticatedCommand.id}`,
      });
    });
  });

  describe('after exceptions', () => {
    it('flushes analytics', async () => {
      try {
        await TestAuthenticatedCommand.run().then(_ => {
          throw new Error('foo');
        });
      } catch (error) {}

      expect(flushAsync).toHaveBeenCalled();
    });
  });
});
