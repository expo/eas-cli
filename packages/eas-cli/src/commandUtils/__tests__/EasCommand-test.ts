import { flushAsync, initAsync, logEvent } from '../../analytics/rudderstackClient';
import { jester as mockJester } from '../../credentials/__tests__/fixtures-constants';
import { getUserAsync } from '../../user/User';
import EasCommand from '../EasCommand';

jest.mock('../../user/User');
jest.mock('../../analytics/rudderstackClient', () => {
  const { AnalyticsEvent } = jest.requireActual('../../analytics/rudderstackClient');
  return {
    AnalyticsEvent,
    logEvent: jest.fn(),
    initAsync: jest.fn(),
    flushAsync: jest.fn(),
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
  jest
    .mocked(getUserAsync)
    .mockReset()
    .mockImplementation(async () => mockJester);
  jest.mocked(initAsync).mockReset();
  jest.mocked(flushAsync).mockReset();
  jest.mocked(logEvent).mockReset();
});

const createTestEasCommand = (): typeof EasCommand => {
  class TestEasCommand extends EasCommand {
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

      expect(jest.mocked(getUserAsync)).toBeCalledTimes(1);
    }, 15_000);

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
