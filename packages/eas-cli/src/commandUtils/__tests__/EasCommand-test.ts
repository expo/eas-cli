import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql/error';
import { v4 as uuidv4 } from 'uuid';

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
const mockRequestId = uuidv4();

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

const createTestEasCommand = (): typeof EasCommand => {
  class TestEasCommand extends EasCommand {
    async runAsync(): Promise<void> {}
  }

  TestEasCommand.id = 'testEasCommand'; // normally oclif will assign ids, but b/c this is located outside the commands folder it will not
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

      it('logs the cleaned message with request ID if present', async () => {
        const TestEasCommand = createTestEasCommand();
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        const graphQLError = new GraphQLError(
          'Unexpected GraphQL error message',
          null,
          null,
          null,
          null,
          null,
          {
            errorCode: 'UNKNOWN_GRAPHQL_ERROR',
            requestId: mockRequestId,
          }
        );
        const graphQLErrors = [graphQLError];
        const error = new CombinedError({ graphQLErrors });
        runAsyncMock.mockImplementation(() => {
          throw error;
        });
        try {
          await TestEasCommand.run();
        } catch {}

        expect(logErrorSpy).toBeCalledWith(
          `Unexpected GraphQL error message\nRequest ID: ${mockRequestId}`
        );
        expect(logDebugSpy).toBeCalledWith(error);
      });

      it('logs the cleaned messages with request IDs if multiple GraphQL errors present', async () => {
        const TestEasCommand = createTestEasCommand();
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        const graphQLErrors = [
          new GraphQLError('Unexpected GraphQL error message', null, null, null, null, null, {
            errorCode: 'UNKNOWN_GRAPHQL_ERROR',
            requestId: mockRequestId,
          }),
          new GraphQLError('Other GraphQL error message', null, null, null, null, null, {
            errorCode: 'OTHER_GRAPHQL_ERROR',
            requestId: mockRequestId,
          }),
          new GraphQLError('Yet another GraphQL error message', null, null, null, null, null, {
            errorCode: 'YET_ANOTHER_GRAPHQL_ERROR',
            requestId: mockRequestId,
          }),
        ];
        const error = new CombinedError({ graphQLErrors });
        runAsyncMock.mockImplementation(() => {
          throw error;
        });
        try {
          await TestEasCommand.run();
        } catch {}

        expect(logErrorSpy).toBeCalledWith(
          'Unexpected GraphQL error message\n' +
            `Request ID: ${mockRequestId}\n` +
            'Other GraphQL error message\n' +
            `Request ID: ${mockRequestId}\n` +
            'Yet another GraphQL error message\n' +
            `Request ID: ${mockRequestId}`
        );
        expect(logDebugSpy).toBeCalledWith(error);
      });

      it('re-throws the error with default base message', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        runAsyncMock.mockImplementation(() => {
          throw new Error('Error message');
        });
        try {
          await TestEasCommand.run();
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('testEasCommand command failed.');
        }
      });

      it('re-throws the error with a different default base message in case of CombinedError', async () => {
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

      it('re-throws the error with a different default base message in case of CombinedError with multiple GraphQLErrors', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype as any, 'runAsync');
        runAsyncMock.mockImplementation(() => {
          const graphQLErrors = [
            new GraphQLError('Unexpected GraphQL error message', null, null, null, null, null, {
              errorCode: 'UNEXPECTED_GRAPHQL_ERROR',
              requestId: mockRequestId,
            }),
            new GraphQLError('Other GraphQL error message', null, null, null, null, null, {
              errorCode: 'OTHER_GRAPHQL_ERROR',
              requestId: mockRequestId,
            }),
            new GraphQLError('Yet another GraphQL error message', null, null, null, null, null, {
              errorCode: 'YET_ANOTHER_GRAPHQL_ERROR',
              requestId: mockRequestId,
            }),
          ];
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
