import {
  flushAsync,
  initAsync,
  logEvent,
  setUserDataAsync,
} from '../../analytics/rudderstackClient';
import { jester } from '../../credentials/__tests__/fixtures-constants';
import SessionManager from '../../user/SessionManager';
import EasCommand from '../EasCommand';

jest.mock('../../user/SessionManager');
jest.mock('../../analytics/rudderstackClient', () => {
  const { AnalyticsEvent } = jest.requireActual('../../analytics/rudderstackClient');
  return {
    AnalyticsEvent,
    logEvent: jest.fn(),
    initAsync: jest.fn(),
    flushAsync: jest.fn(),
    setUserDataAsync: jest.fn(),
  };
});

let originalProcessArgv: string[];

beforeAll(() => {
  originalProcessArgv = process.argv;
  process.argv = [];
});

afterAll(() => {
  process.argv = originalProcessArgv;
});

beforeEach(() => {
  jest.resetAllMocks();
});

const createTestEasCommand = ({
  requireLoggedIn = false,
}: { requireLoggedIn?: boolean } = {}): typeof EasCommand => {
  class TestEasCommand extends EasCommand {
    static override contextDefinition = requireLoggedIn
      ? {
          ...this.ContextOptions.LoggedIn,
        }
      : {};
    async runAsync(): Promise<void> {}
  }

  TestEasCommand.id = 'TestEasCommand'; // normally oclif will assign ids, but b/c this is located outside the commands folder it will not
  return TestEasCommand;
};

describe(EasCommand.name, () => {
  describe('without exceptions', () => {
    // The first test in this suite should have an increased timeout
    // because of the implementation of Command from @oclif/command.
    // It seems that loading config takes significant amount of time
    // and I'm not sure how to mock it.
    //
    // See https://github.com/oclif/command/blob/master/src/command.ts#L80
    // and look for "Config.load"
    it('ensures the user data is read', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run();

      const sessionManagerSpy = jest.spyOn(SessionManager.prototype, 'getUserAsync');
      expect(sessionManagerSpy).toBeCalledTimes(1);
    }, 15_000);

    it('sets the analytics user data when command requires log in', async () => {
      const sessionManagerEnsureLoggedInSpy = jest.spyOn(
        SessionManager.prototype,
        'ensureLoggedInAsync'
      );
      sessionManagerEnsureLoggedInSpy.mockResolvedValue({
        actor: jester,
        authenticationInfo: { accessToken: null, sessionSecret: '' },
      });

      const TestEasCommand = createTestEasCommand({ requireLoggedIn: true });
      await TestEasCommand.run();

      expect(setUserDataAsync).toHaveBeenCalledWith(jester.id, {
        user_id: jester.id,
        user_type: jester.__typename,
        username: jester.username,
      });
    });

    it('sets the analytics user data when command does not require log in if user already logged in', async () => {
      const sessionManagerGetUserAsyncSpy = jest.spyOn(SessionManager.prototype, 'getUserAsync');
      sessionManagerGetUserAsyncSpy.mockResolvedValue(jester);

      const TestEasCommand = createTestEasCommand({ requireLoggedIn: false });
      await TestEasCommand.run();

      expect(setUserDataAsync).toHaveBeenCalledWith(jester.id, {
        user_id: jester.id,
        user_type: jester.__typename,
        username: jester.username,
      });
    });

    it('does not set the analytics user data when command does not require log in if user is not logged in', async () => {
      const TestEasCommand = createTestEasCommand({ requireLoggedIn: false });
      await TestEasCommand.run();

      expect(setUserDataAsync).not.toHaveBeenCalled();
    });

    it('initializes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run();

      expect(initAsync).toHaveBeenCalled();
    });

    it('flushes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run();

      expect(flushAsync).toHaveBeenCalled();
    });

    it('logs events', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run();

      expect(logEvent).toHaveBeenCalledWith('action', {
        action: `eas ${TestEasCommand.id}`,
      });
    });
  });

  describe('after exceptions', () => {
    it('flushes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      try {
        await TestEasCommand.run().then(() => {
          throw new Error('foo');
        });
      } catch {}

      expect(flushAsync).toHaveBeenCalled();
    });
  });
});
