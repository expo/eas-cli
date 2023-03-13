import { Platform } from '@expo/eas-build-job';
import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql/error';

import { EasCommandError } from '../../commandUtils/errors';
import Build from '../../commands/build';
import Log, { link } from '../../log';
import { testExports } from '../build';
import {
  EasBuildDownForMaintenanceError,
  EasBuildFreeTierDisabledAndroidError,
  EasBuildFreeTierDisabledError,
  EasBuildFreeTierDisabledIOSError,
  EasBuildTooManyPendingBuildsError,
  RequestValidationError,
  TurtleDeprecatedJobFormatError,
} from '../errors';
const { handleBuildRequestError } = testExports;

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

const getGraphQLError = (message: string, errorCode: string): GraphQLError => {
  return new GraphQLError(message, null, null, null, null, null, {
    errorCode,
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
      describe('throws correct EasCommandError subclass', () => {
        describe('for TURTLE_DEPRECATED_JOB_FORMAT', () => {
          it('does it with Android', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'TURTLE_DEPRECATED_JOB_FORMAT');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, TurtleDeprecatedJobFormatError);
            }
          });

          it('does it with iOS', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'TURTLE_DEPRECATED_JOB_FORMAT');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, TurtleDeprecatedJobFormatError);
            }
          });
        });

        describe('for EAS_BUILD_FREE_TIER_DISABLED', () => {
          it('does it with Android', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, EasBuildFreeTierDisabledError);
            }
          });

          it('does it with iOS', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, EasBuildFreeTierDisabledError);
            }
          });
        });

        it('does it for EAS_BUILD_FREE_TIER_DISABLED_IOS', async () => {
          const platform = Platform.IOS;
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED_IOS');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            assertReThrownError(caughtError as Error, EasBuildFreeTierDisabledIOSError);
          }
        });

        it('does it for EAS_BUILD_FREE_TIER_DISABLED_ANDROID', async () => {
          const platform = Platform.ANDROID;
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED_ANDROID');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            assertReThrownError(caughtError as Error, EasBuildFreeTierDisabledAndroidError);
          }
        });

        describe('for VALIDATION_ERROR', () => {
          it('does it with Android', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'VALIDATION_ERROR');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, RequestValidationError);
            }
          });

          it('does it with iOS', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'VALIDATION_ERROR');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            try {
              handleBuildRequestError(error, platform);
            } catch (caughtError) {
              assertReThrownError(caughtError as Error, RequestValidationError);
            }
          });
        });
      });
    });

    describe('error is other expected graphQL-related error', () => {
      describe('throws correct EasCommandError subclass', () => {
        describe('for EAS_BUILD_DOWN_FOR_MAINTENANCE', () => {
          it('does it with Android', async () => {
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

          it('does it with iOS', async () => {
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

        describe('for EAS_BUILD_TOO_MANY_PENDING_BUILDS', () => {
          it('does it with Android', async () => {
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

          it('does it with iOS', async () => {
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
      describe('throws base Error class with custom message', () => {
        it('does it with Android', async () => {
          const platform = Platform.ANDROID;
          const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            assertReThrownError(caughtError as Error, Error, EXPECTED_GENERIC_MESSAGE);
          }
        });

        it('does it with iOS', async () => {
          const platform = Platform.IOS;
          const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
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

    describe('error is unexpected non-graphQL-related error', () => {
      describe('throws base Error class with propagated message', () => {
        it('does it with Android', async () => {
          const platform = Platform.ANDROID;
          const error = new Error('Non-graphQL-related error');

          try {
            handleBuildRequestError(error, platform);
          } catch (caughtError) {
            expect(caughtError).toStrictEqual(error);
          }
        });

        it('does it with iOS', async () => {
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
