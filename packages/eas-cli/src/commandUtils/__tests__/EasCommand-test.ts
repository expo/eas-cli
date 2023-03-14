import { CombinedError } from '@urql/core';

import { AnalyticsWithOrchestration, createAnalyticsAsync } from '../../analytics/AnalyticsManager';
import Log from '../../log';
import SessionManager from '../../user/SessionManager';
import EasCommand from '../EasCommand';

jest.mock('../../user/User');
jest.mock('../../user/SessionManager');
jest.mock('../../analytics/AnalyticsManager', () => {
  const { CommandEvent } = jest.requireActual('../../analytics/AnalyticsManager');
  return {
    CommandEvent,
    createAnalyticsAsync: jest.fn(),
  };
});
jest.mock('../../log');

let originalProcessArgv: string[];

beforeAll(() => {
  originalProcessArgv = process.argv;
  process.argv = [];
});

afterAll(() => {
  process.argv = originalProcessArgv;
});

const analytics: AnalyticsWithOrchestration = {
  logEvent: jest.fn((): void => {}),
  setActor: jest.fn((): void => {}),
  flushAsync: jest.fn(async (): Promise<void> => {}),
};

beforeEach(() => {
  jest.resetAllMocks();

  jest.mocked(createAnalyticsAsync).mockResolvedValue(analytics);
});

const createTestEasCommand = (baseErrorMessage?: string): typeof EasCommand => {
  class TestEasCommand extends EasCommand {
    async runAsync(): Promise<void> {}
    protected override baseErrorMessage = baseErrorMessage;
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
    }, 30_000);

    it('initializes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run();

      expect(createAnalyticsAsync).toHaveBeenCalled();
    });

    it('flushes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run();

      expect(analytics.flushAsync).toHaveBeenCalled();
    });

    it('logs events', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run();

      expect(analytics.logEvent).toHaveBeenCalledWith('action', {
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

      expect(analytics.flushAsync).toHaveBeenCalled();
    });

    describe('catch', () => {
      it('logs the message', async () => {
        const TestEasCommand = createTestEasCommand();
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        const error = new Error('Unexpected, internal error message');
        runAsyncMock.mockImplementation(() => {
          throw error;
        });
        try {
          await TestEasCommand.run();
        } catch {}

        expect(logErrorSpy).toBeCalledWith('Unexpected, internal error message');
        expect(logDebugSpy).toBeCalledWith(error);
      });

      it('logs the cleaned message if needed', async () => {
        const TestEasCommand = createTestEasCommand();
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        const graphQLErrors = ['Unexpected GraphQL error message'];
        const error = new CombinedError({ graphQLErrors });
        runAsyncMock.mockImplementation(() => {
          throw error;
        });
        try {
          await TestEasCommand.run();
        } catch {}

        expect(logErrorSpy).toBeCalledWith('Unexpected GraphQL error message');
        expect(logDebugSpy).toBeCalledWith(error);
      });

      it('re-throws the error with new message if provided', async () => {
        const TestEasCommand = createTestEasCommand('New base error message');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        runAsyncMock.mockImplementation(() => {
          throw new Error('Error message');
        });
        try {
          await TestEasCommand.run();
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('New base error message');
        }
      });

      it('re-throws the error with default base message if new one not provided', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        runAsyncMock.mockImplementation(() => {
          throw new Error('Error message');
        });
        try {
          await TestEasCommand.run();
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('TestEasCommand command failed.');
        }
      });

      it('re-throws the error with default base message if new one not provided - command id is capitalized if needed', async () => {
        const TestEasCommand = createTestEasCommand();
        TestEasCommand.id = 'testEasCommand';
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        runAsyncMock.mockImplementation(() => {
          throw new Error('Error message');
        });
        try {
          await TestEasCommand.run();
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('TestEasCommand command failed.');
        }
      });

      it('re-throws the error with a different default base message in case of graphQLError', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        runAsyncMock.mockImplementation(() => {
          const graphQLErrors = ['Unexpected GraphQL error message'];
          throw new CombinedError({ graphQLErrors });
        });
        try {
          await TestEasCommand.run();
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('GraphQL request failed.');
        }
      });
    });
  });
});
