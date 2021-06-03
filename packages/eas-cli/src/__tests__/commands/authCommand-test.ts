import { flushAsync, initAsync } from '../../analytics';
import AuthenticatedCommand from '../../commands/abstract/authenticatedCommand';
import { jester as mockJester } from '../../credentials/__tests__/fixtures-constants';
import { ensureLoggedInAsync } from '../../user/actions';
import TestAuthrizedCommand from './TestAuthrizedCommand';

describe(AuthenticatedCommand.name, () => {
  beforeAll(() => {
    jest.mock('../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));
    jest.mock('../../analytics', () => ({ initAsync: jest.fn(), flushAsync: jest.fn() }));
  });

  afterEach(() => {
    (ensureLoggedInAsync as jest.Mock).mockClear();
    (initAsync as jest.Mock).mockClear();
    (flushAsync as jest.Mock).mockClear();
  });

  describe('without exceptions', () => {
    it('ensures the user is logged in', async () => {
      await TestAuthrizedCommand.run();

      expect(ensureLoggedInAsync).toHaveReturnedWith(mockJester);
    });

    it('initializes analytics', async () => {
      await TestAuthrizedCommand.run();

      expect(initAsync).toHaveBeenCalled();
    });

    it('flushes analytics', async () => {
      await TestAuthrizedCommand.run();

      expect(flushAsync).toHaveBeenCalled();
    });
  });

  describe('after exceptions', () => {
    it('flushes analytics', async () => {
      try {
        await TestAuthrizedCommand.run().then(_ => {
          throw new Error('foo');
        });
      } catch (error) {}

      expect(flushAsync).toHaveBeenCalled();
    });
  });
});
