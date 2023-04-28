import { Platform } from '@expo/eas-build-job';
import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql/error';
import { v4 as uuidv4 } from 'uuid';

import { EasCommandError } from '../../commandUtils/errors';
import Build from '../../commands/build';
import Log, { link } from '../../log';
import { handleBuildRequestError } from '../build';
import {
  EasBuildDownForMaintenanceError,
  EasBuildFreeTierDisabledAndroidError,
  EasBuildFreeTierDisabledError,
  EasBuildFreeTierDisabledIOSError,
  EasBuildTooManyPendingBuildsError,
  RequestValidationError,
  TurtleDeprecatedJobFormatError,
} from '../errors';

beforeEach(() => {
  jest.resetAllMocks();
});

const EXPECTED_STRINGIFIED_GRAPHQL_ERROR_JSON = `[
  {
    "message": "Error 1"
  },
  {
    "message": "Error 2"
  },
  {
    "message": "Error 3"
  }
]`;

const EXPECTED_EAS_BUILD_DOWN_MESSAGE = `EAS Build is down for maintenance. Try again later. Check ${link(
  'https://status.expo.dev/'
)} for updates.`;

const EXPECTED_MAX_BUILD_COUNT_MESSAGE_ANDROID = `You have already reached the maximum number of pending Android builds for your account. Try again later.`;
const EXPECTED_MAX_BUILD_COUNT_MESSAGE_IOS = `You have already reached the maximum number of pending iOS builds for your account. Try again later.`;

const EXPECTED_GENERIC_MESSAGE =
  'Build request failed. Make sure you are using the latest eas-cli version. If the problem persists, report the issue.';

const mockRequestId = uuidv4();
const getGraphQLError = (message: string, errorCode: string): GraphQLError => {
  return new GraphQLError(message, null, null, null, null, null, {
    errorCode,
    requestId: mockRequestId,
  });
};

const assertReThrownError = (
  caughtError: CombinedError | Error,
  expectedType: typeof EasCommandError,
  expectedMessage: string = 'Error 1'
): void => {
  expect(caughtError).toBeInstanceOf(expectedType);
  expect((caughtError as Error).message).toEqual(expectedMessage);
};

describe(Build.name, () => {
  describe('handle build request errors', () => {
    describe('logs graphQL errors to debug if present', () => {
      it('does it with Android', async () => {
        const platform = Platform.ANDROID;
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const graphQLErrors = ['Error 1', 'Error 2', 'Error 3'];
        const error = new CombinedError({ graphQLErrors });

        try {
          handleBuildRequestError(error, platform);
        } catch {}

        expect(logDebugSpy).toBeCalledWith(EXPECTED_STRINGIFIED_GRAPHQL_ERROR_JSON);
      });

      it('does it with iOS', async () => {
        const platform = Platform.IOS;
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const graphQLErrors = ['Error 1', 'Error 2', 'Error 3'];
        const error = new CombinedError({ graphQLErrors });

        try {
          handleBuildRequestError(error, platform);
        } catch {}

        expect(logDebugSpy).toBeCalledWith(EXPECTED_STRINGIFIED_GRAPHQL_ERROR_JSON);
      });
    });

    describe('logs nothing to debug if graphQLErrors not present', () => {
      it('does it with Android', async () => {
        const platform = Platform.ANDROID;
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const error = new Error('Generic error');

        try {
          handleBuildRequestError(error, platform);
        } catch {}

        expect(logDebugSpy).toBeCalledWith(undefined);
      });

      it('does it with iOS', async () => {
        const platform = Platform.IOS;
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const error = new Error('Generic error');

        try {
          handleBuildRequestError(error, platform);
        } catch {}

        expect(logDebugSpy).toBeCalledWith(undefined);
      });
    });

    describe('error is server-side defined error', () => {
      describe('for TURTLE_DEPRECATED_JOB_FORMAT', () => {
        describe('with Android', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'TURTLE_DEPRECATED_JOB_FORMAT');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, TurtleDeprecatedJobFormatError, 'Error 1');
            }
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'TURTLE_DEPRECATED_JOB_FORMAT');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, TurtleDeprecatedJobFormatError, 'Error 1');
            }
          });
        });
      });

      describe('for EAS_BUILD_FREE_TIER_DISABLED', () => {
        describe('with Android', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, EasBuildFreeTierDisabledError, 'Error 1');
            }
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, EasBuildFreeTierDisabledError, 'Error 1');
            }
          });
        });
      });
      describe('for EAS_BUILD_FREE_TIER_DISABLED_IOS', () => {
        it('throws correct EasCommandError subclass', async () => {
          const platform = Platform.IOS;
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED_IOS');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            assertReThrownError(caughtError as Error, EasBuildFreeTierDisabledIOSError, 'Error 1');
          }
        });
      });
      describe('for EAS_BUILD_FREE_TIER_DISABLED_ANDROID', () => {
        it('throws correct EasCommandError subclass', async () => {
          const platform = Platform.ANDROID;
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED_ANDROID');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            assertReThrownError(
              caughtError as Error,
              EasBuildFreeTierDisabledAndroidError,
              'Error 1'
            );
          }
        });
      });

      describe('for VALIDATION_ERROR', () => {
        describe('with Android', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'VALIDATION_ERROR');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, RequestValidationError, 'Error 1');
            }
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'VALIDATION_ERROR');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, RequestValidationError, 'Error 1');
            }
          });
        });
      });
    });

    describe('error is other expected graphQL-related error', () => {
      describe('for EAS_BUILD_DOWN_FOR_MAINTENANCE', () => {
        describe('with Android', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_DOWN_FOR_MAINTENANCE');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(
                caughtError as Error,
                EasBuildDownForMaintenanceError,
                EXPECTED_EAS_BUILD_DOWN_MESSAGE
              );
            }
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_DOWN_FOR_MAINTENANCE');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(
                caughtError as Error,
                EasBuildDownForMaintenanceError,
                EXPECTED_EAS_BUILD_DOWN_MESSAGE
              );
            }
          });
        });
      });

      describe('for EAS_BUILD_TOO_MANY_PENDING_BUILDS', () => {
        describe('with Android', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_TOO_MANY_PENDING_BUILDS');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(
                caughtError as Error,
                EasBuildTooManyPendingBuildsError,
                EXPECTED_MAX_BUILD_COUNT_MESSAGE_ANDROID
              );
            }
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_TOO_MANY_PENDING_BUILDS');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(
                caughtError as Error,
                EasBuildTooManyPendingBuildsError,
                EXPECTED_MAX_BUILD_COUNT_MESSAGE_IOS
              );
            }
          });
        });
      });
    });

    describe('error is unexpected graphQL-related error', () => {
      describe('with Android', () => {
        it('throws base Error class with custom message', async () => {
          const platform = Platform.ANDROID;
          const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });
          const expectedMessage = EXPECTED_GENERIC_MESSAGE + `\nRequest ID: ${mockRequestId}`;

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            assertReThrownError(caughtError as Error, Error, expectedMessage);
          }
        });
        describe('without request ID', () => {
          it('throws base Error class with custom message without request ID line', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
            delete graphQLError.extensions.requestId;
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, Error, EXPECTED_GENERIC_MESSAGE);
            }
          });
        });
      });
      describe('with iOS', () => {
        it('throws base Error class with custom message', async () => {
          const platform = Platform.IOS;
          const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });
          const expectedMessage = EXPECTED_GENERIC_MESSAGE + `\nRequest ID: ${mockRequestId}`;

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            assertReThrownError(caughtError as Error, Error, expectedMessage);
          }
        });
        describe('without request ID', () => {
          it('throws base Error class with custom message without request ID line', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
            delete graphQLError.extensions.requestId;
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, Error, EXPECTED_GENERIC_MESSAGE);
            }
          });
        });
      });
    });

    describe('error is unexpected non-graphQL-related error', () => {
      describe('with Android', () => {
        it('throws base Error class with propagated message', async () => {
          const platform = Platform.ANDROID;
          const error = new Error('Non-graphQL-related error');

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            expect(caughtError).toStrictEqual(error);
          }
        });
      });
      describe('with iOS', () => {
        it('throws base Error class with propagated message', async () => {
          const platform = Platform.IOS;
          const error = new Error('Non-graphQL-related error');

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            expect(caughtError).toStrictEqual(error);
          }
        });
      });
    });
  });
});
