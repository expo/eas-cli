import { Config } from '@oclif/core';
import { v4 as uuidv4 } from 'uuid';

import { AnalyticsWithOrchestration } from '../../analytics/AnalyticsManager';

jest.mock('../../user/User');
jest.mock('../../user/SessionManager');
jest.mock('../../sentry', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    setTag: jest.fn(),
    setUser: jest.fn(),
    withScope: jest.fn(),
    captureException: jest.fn(),
    flush: jest.fn(async (): Promise<void> => {}),
  },
}));
jest.mock('../../analytics/AnalyticsManager', () => {
  const { CommandEvent } = jest.requireActual('../../analytics/AnalyticsManager');
  return {
    CommandEvent,
    createAnalyticsAsync: jest.fn(),
  };
});
jest.mock('../../log');

const mockRequestId = uuidv4();

/**
 * A Config that is never loaded. Letting oclif load one discovers and requires
 * every command in the package, which takes seconds under coverage with a cold
 * transform cache and has timed out on slow CI runners. Nothing here needs the
 * command table or hooks.
 */
function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

const mockConfig = getMockOclifConfig();

const analytics: AnalyticsWithOrchestration = {
  logEvent: jest.fn((): void => {}),
  setActor: jest.fn((): void => {}),
  flushAsync: jest.fn(async (): Promise<void> => {}),
};

beforeEach(() => {
  jest.resetAllMocks();
});

const createTestEasCommand = (): any => {
  const { createAnalyticsAsync } = jest.requireMock('../../analytics/AnalyticsManager');
  createAnalyticsAsync.mockResolvedValue(analytics);
  const EasCommand = require('../EasCommand').default;

  class TestEasCommand extends EasCommand {
    async runAsync(): Promise<void> {}
  }

  TestEasCommand.id = 'testEasCommand'; // normally oclif will assign ids, but b/c this is located outside the commands folder it will not
  return TestEasCommand;
};

describe('EasCommand', () => {
  describe('without exceptions', () => {
    it('ensures the user data is read', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run([], mockConfig);

      const SessionManager = jest.requireMock('../../user/SessionManager').default;
      const sessionManagerSpy = jest.spyOn(SessionManager.prototype, 'getUserAsync');
      expect(sessionManagerSpy).toBeCalledTimes(1);
    });

    it('initializes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run([], mockConfig);

      const { createAnalyticsAsync } = jest.requireMock('../../analytics/AnalyticsManager');
      expect(createAnalyticsAsync).toHaveBeenCalled();
    });

    it('flushes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run([], mockConfig);

      expect(analytics.flushAsync).toHaveBeenCalled();
    });

    it('flushes Sentry', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run([], mockConfig);

      const Sentry = jest.requireMock('../../sentry').default;
      expect(Sentry.flush).toHaveBeenCalled();
    });

    it('logs events', async () => {
      const TestEasCommand = createTestEasCommand();
      await TestEasCommand.run([], mockConfig);

      expect(analytics.logEvent).toHaveBeenCalledWith('action', {
        action: `eas ${TestEasCommand.id}`,
      });
    });
  });

  describe('after exceptions', () => {
    it('flushes analytics', async () => {
      const TestEasCommand = createTestEasCommand();
      try {
        await TestEasCommand.run([], mockConfig).then(() => {
          throw new Error('foo');
        });
      } catch {}

      expect(analytics.flushAsync).toHaveBeenCalled();
    });

    describe('catch', () => {
      it('captures unexpected errors', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const error = new Error('Unexpected, internal error message');
        const sentryScope = {
          setTag: jest.fn(),
          setExtra: jest.fn(),
        };
        const Sentry = jest.requireMock('../../sentry').default;
        Sentry.withScope.mockImplementation((cb: (scope: typeof sentryScope) => void) => {
          cb(sentryScope);
        });
        runAsyncMock.mockImplementation(() => {
          throw error;
        });

        try {
          await TestEasCommand.run([], mockConfig);
        } catch {}

        expect(sentryScope.setTag).toHaveBeenCalledWith('command', TestEasCommand.id);
        expect(sentryScope.setTag).toHaveBeenCalledWith('error_name', error.name);
        expect(sentryScope.setExtra).toHaveBeenCalledWith('commandId', TestEasCommand.id);
        expect(sentryScope.setExtra).toHaveBeenCalledWith(
          'commandMessage',
          `${TestEasCommand.id} command failed.`
        );
        expect(sentryScope.setExtra).toHaveBeenCalledWith('originalMessage', error.message);
        expect(Sentry.captureException).toHaveBeenCalledWith(error);
      });

      it('captures expected command errors', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const { EasCommandError } = require('../errors');
        const Sentry = jest.requireMock('../../sentry').default;
        Sentry.withScope.mockImplementation((cb: (scope: any) => void) => {
          cb({ setTag: jest.fn(), setExtra: jest.fn() });
        });
        runAsyncMock.mockImplementation(() => {
          throw new EasCommandError('Expected user-facing error');
        });

        try {
          await TestEasCommand.run([], mockConfig);
        } catch {}

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      });

      it('logs the message', async () => {
        const TestEasCommand = createTestEasCommand();
        const Log = jest.requireMock('../../log').default;
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const error = new Error('Unexpected, internal error message');
        runAsyncMock.mockImplementation(() => {
          throw error;
        });
        try {
          await TestEasCommand.run([], mockConfig);
        } catch {}

        expect(logErrorSpy).toBeCalledWith('Unexpected, internal error message');
        expect(logDebugSpy).toBeCalledWith(error);
      });

      it('logs the cleaned message if needed', async () => {
        const TestEasCommand = createTestEasCommand();
        const Log = jest.requireMock('../../log').default;
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const { CombinedError } = require('@urql/core');
        const graphQLErrors = ['Unexpected GraphQL error message'];
        const error = new CombinedError({ graphQLErrors });
        runAsyncMock.mockImplementation(() => {
          throw error;
        });
        try {
          await TestEasCommand.run([], mockConfig);
        } catch {}

        expect(logErrorSpy).toBeCalledWith('Unexpected GraphQL error message');
        expect(logDebugSpy).toBeCalledWith(error);
      });

      it('logs the cleaned message with request ID if present', async () => {
        const TestEasCommand = createTestEasCommand();
        const Log = jest.requireMock('../../log').default;
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const { CombinedError } = require('@urql/core');
        const { GraphQLError } = require('graphql/error');
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
          await TestEasCommand.run([], mockConfig);
        } catch {}

        expect(logErrorSpy).toBeCalledWith(
          `Unexpected GraphQL error message\nRequest ID: ${mockRequestId}`
        );
        expect(logDebugSpy).toBeCalledWith(error);
      });

      it('logs the cleaned messages with request IDs if multiple GraphQL errors present', async () => {
        const TestEasCommand = createTestEasCommand();
        const Log = jest.requireMock('../../log').default;
        const logErrorSpy = jest.spyOn(Log, 'error');
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const { CombinedError } = require('@urql/core');
        const { GraphQLError } = require('graphql/error');
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
          await TestEasCommand.run([], mockConfig);
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
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        runAsyncMock.mockImplementation(() => {
          throw new Error('Error message');
        });
        try {
          await TestEasCommand.run([], mockConfig);
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('testEasCommand command failed.');
        }
      });

      it('re-throws the error with a different default base message in case of CombinedError', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const { CombinedError } = require('@urql/core');
        runAsyncMock.mockImplementation(() => {
          const graphQLErrors = ['Unexpected GraphQL error message'];
          throw new CombinedError({ graphQLErrors });
        });
        try {
          await TestEasCommand.run([], mockConfig);
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('GraphQL request failed.');
        }
      });

      it('re-throws the error with a different default base message in case of CombinedError with multiple GraphQLErrors', async () => {
        const TestEasCommand = createTestEasCommand();
        const runAsyncMock = jest.spyOn(TestEasCommand.prototype, 'runAsync');
        const { CombinedError } = require('@urql/core');
        const { GraphQLError } = require('graphql/error');
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
          await TestEasCommand.run([], mockConfig);
        } catch (caughtError) {
          expect(caughtError).toBeInstanceOf(Error);
          expect((caughtError as Error).message).toEqual('GraphQL request failed.');
        }
      });
    });
  });
});
