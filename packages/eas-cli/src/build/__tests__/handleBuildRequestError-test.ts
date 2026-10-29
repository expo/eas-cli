import { Platform } from '@expo/eas-build-job';
import { CombinedError } from '@urql/core';
import chalk from 'chalk';
import { GraphQLError } from 'graphql/error';
import { v4 as uuidv4 } from 'uuid';

import { getErrorAsync } from '../../__tests__/commands/utils';
import { EasCommandError } from '../../commandUtils/errors';
import Build from '../../commands/build';
import Log, { link } from '../../log';
import { handleBuildRequestErrorAsync } from '../build';
import {
  EasBuildDownForMaintenanceError,
  EasBuildFreeTierDisabledAndroidError,
  EasBuildFreeTierDisabledError,
  EasBuildFreeTierDisabledIOSError,
  EasBuildFreeTierIosLimitExceededError,
  EasBuildFreeTierLimitExceededError,
  EasBuildResourceClassNotAvailableInFreeTierError,
  EasBuildTooManyPendingBuildsError,
  EasBuildUnauthorizedError,
  RequestValidationError,
  TurtleDeprecatedJobFormatError,
} from '../errors';
import {
  FreeTierLimitCheckoutExperiment,
  maybeOfferFreeTierLimitCheckoutAsync,
} from '../freeTierLimitCheckout';

jest.mock('../freeTierLimitCheckout', () => ({
  ...jest.requireActual('../freeTierLimitCheckout'),
  maybeOfferFreeTierLimitCheckoutAsync: jest.fn(),
}));

const CHECKOUT_EXPERIMENT = { accountId: 'account-id' } as FreeTierLimitCheckoutExperiment;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(maybeOfferFreeTierLimitCheckoutAsync).mockResolvedValue(false);
});

const EXPECTED_STRINGIFIED_GRAPHQL_ERROR_JSON = `Build request error details:
{
  "message": "[GraphQL] Error 1\\n[GraphQL] Error 2\\n[GraphQL] Error 3",
  "graphQLErrors": [
    {
      "name": "GraphQLError",
      "extensions": {},
      "message": "Error 1"
    },
    {
      "name": "GraphQLError",
      "extensions": {},
      "message": "Error 2"
    },
    {
      "name": "GraphQLError",
      "extensions": {},
      "message": "Error 3"
    }
  ]
}`;

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
  expectedType: new (...args: any[]) => Error,
  expectedMessage: string = 'Error 1',
  { messageAlreadyPrinted = false }: { messageAlreadyPrinted?: boolean } = {}
): void => {
  expect(caughtError).toBeInstanceOf(expectedType);
  expect((caughtError as Error).message).toEqual(expectedMessage);
  expect((caughtError as EasCommandError).messageAlreadyPrinted ?? false).toBe(
    messageAlreadyPrinted
  );
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
          await handleBuildRequestErrorAsync(error, platform);
        } catch {}

        expect(logDebugSpy).toBeCalledWith(EXPECTED_STRINGIFIED_GRAPHQL_ERROR_JSON);
      });

      it('does it with iOS', async () => {
        const platform = Platform.IOS;
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const graphQLErrors = ['Error 1', 'Error 2', 'Error 3'];
        const error = new CombinedError({ graphQLErrors });

        try {
          await handleBuildRequestErrorAsync(error, platform);
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
          await handleBuildRequestErrorAsync(error, platform);
        } catch {}

        expect(logDebugSpy).not.toHaveBeenCalled();
      });

      it('does it with iOS', async () => {
        const platform = Platform.IOS;
        const logDebugSpy = jest.spyOn(Log, 'debug');
        const error = new Error('Generic error');

        try {
          await handleBuildRequestErrorAsync(error, platform);
        } catch {}

        expect(logDebugSpy).not.toHaveBeenCalled();
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

            const handleBuildRequestErrorThrownError = await getErrorAsync<TurtleDeprecatedJobFormatError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              TurtleDeprecatedJobFormatError,
              'Error 1'
            );
          });

          it('throws correct EasBuildResourceClassNotAvailableInFreeTierError', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError(
              'Error 1',
              'EAS_BUILD_RESOURCE_CLASS_NOT_AVAILABLE_IN_FREE_TIER'
            );
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError =
              await getErrorAsync<EasBuildResourceClassNotAvailableInFreeTierError>(async () => {
                await handleBuildRequestErrorAsync(error, platform);
              });

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildResourceClassNotAvailableInFreeTierError,
              'Error 1'
            );
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'TURTLE_DEPRECATED_JOB_FORMAT');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError = await getErrorAsync<TurtleDeprecatedJobFormatError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              TurtleDeprecatedJobFormatError,
              'Error 1'
            );
          });

          it('throws correct EasBuildResourceClassNotAvailableInFreeTierError', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError(
              'Error 1',
              'EAS_BUILD_RESOURCE_CLASS_NOT_AVAILABLE_IN_FREE_TIER'
            );
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError =
              await getErrorAsync<EasBuildResourceClassNotAvailableInFreeTierError>(async () => {
                await handleBuildRequestErrorAsync(error, platform);
              });

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildResourceClassNotAvailableInFreeTierError,
              'Error 1'
            );
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

            const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildFreeTierDisabledError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildFreeTierDisabledError,
              'Error 1'
            );
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildFreeTierDisabledError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildFreeTierDisabledError,
              'Error 1'
            );
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
            await handleBuildRequestErrorAsync(error, platform);
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

          const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildFreeTierDisabledAndroidError>(
            async () => {
              await handleBuildRequestErrorAsync(error, platform);
            }
          );

          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildFreeTierDisabledAndroidError,
            'Error 1'
          );
        });
      });
      describe('for EAS_BUILD_FREE_TIER_LIMIT_EXCEEDED', () => {
        it('throws correct EasCommandError subclass', async () => {
          const platform = Platform.ANDROID;
          const accountName = 'test-account';
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_LIMIT_EXCEEDED');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });

          const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildFreeTierLimitExceededError>(
            async () => {
              await handleBuildRequestErrorAsync(error, platform, accountName);
            }
          );

          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildFreeTierLimitExceededError,
            'Error 1\nRun eas billing:subscribe starter --account test-account to upgrade to the Starter plan.'
          );
        });
      });
      describe('for free tier limit errors in the checkout experiment', () => {
        it('offers the checkout with the limit message and marks the message as printed', async () => {
          jest.mocked(maybeOfferFreeTierLimitCheckoutAsync).mockResolvedValue(true);
          const platform = Platform.ANDROID;
          const accountName = 'test-account';
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_LIMIT_EXCEEDED');
          const error = new CombinedError({ graphQLErrors: [graphQLError] });
          const expectedMessage =
            'Error 1\nRun eas billing:subscribe starter --account test-account to upgrade to the Starter plan.';

          const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildFreeTierLimitExceededError>(
            async () => {
              await handleBuildRequestErrorAsync(
                error,
                platform,
                accountName,
                CHECKOUT_EXPERIMENT
              );
            }
          );

          expect(maybeOfferFreeTierLimitCheckoutAsync).toHaveBeenCalledWith(
            expectedMessage,
            CHECKOUT_EXPERIMENT
          );
          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildFreeTierLimitExceededError,
            expectedMessage,
            { messageAlreadyPrinted: true }
          );
        });

        it('offers the checkout for the iOS limit error too', async () => {
          jest.mocked(maybeOfferFreeTierLimitCheckoutAsync).mockResolvedValue(true);
          const platform = Platform.IOS;
          const accountName = 'test-account';
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_IOS_LIMIT_EXCEEDED');
          const error = new CombinedError({ graphQLErrors: [graphQLError] });
          const expectedMessage =
            'Error 1\nRun eas billing:subscribe starter --account test-account to upgrade to the Starter plan.';

          const handleBuildRequestErrorThrownError =
            await getErrorAsync<EasBuildFreeTierIosLimitExceededError>(async () => {
              await handleBuildRequestErrorAsync(
                error,
                platform,
                accountName,
                CHECKOUT_EXPERIMENT
              );
            });

          expect(maybeOfferFreeTierLimitCheckoutAsync).toHaveBeenCalledWith(
            expectedMessage,
            CHECKOUT_EXPERIMENT
          );
          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildFreeTierIosLimitExceededError,
            expectedMessage,
            { messageAlreadyPrinted: true }
          );
        });

        it('leaves the message for the command to print when nothing was offered', async () => {
          const platform = Platform.ANDROID;
          const accountName = 'test-account';
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_LIMIT_EXCEEDED');
          const error = new CombinedError({ graphQLErrors: [graphQLError] });

          const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildFreeTierLimitExceededError>(
            async () => {
              await handleBuildRequestErrorAsync(
                error,
                platform,
                accountName,
                CHECKOUT_EXPERIMENT
              );
            }
          );

          expect(maybeOfferFreeTierLimitCheckoutAsync).toHaveBeenCalledTimes(1);
          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildFreeTierLimitExceededError,
            'Error 1\nRun eas billing:subscribe starter --account test-account to upgrade to the Starter plan.',
            { messageAlreadyPrinted: false }
          );
        });

        it('does not offer the checkout for other server-side errors', async () => {
          const platform = Platform.ANDROID;
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_DISABLED');
          const error = new CombinedError({ graphQLErrors: [graphQLError] });

          const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildFreeTierDisabledError>(
            async () => {
              await handleBuildRequestErrorAsync(
                error,
                platform,
                undefined,
                CHECKOUT_EXPERIMENT
              );
            }
          );

          expect(maybeOfferFreeTierLimitCheckoutAsync).not.toHaveBeenCalled();
          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildFreeTierDisabledError,
            'Error 1'
          );
        });
      });
      describe('for EAS_BUILD_FREE_TIER_IOS_LIMIT_EXCEEDED', () => {
        it('throws correct EasCommandError subclass', async () => {
          const platform = Platform.ANDROID;
          const accountName = 'test-account';
          const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_FREE_TIER_IOS_LIMIT_EXCEEDED');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });

          const handleBuildRequestErrorThrownError =
            await getErrorAsync<EasBuildFreeTierIosLimitExceededError>(async () => {
              await handleBuildRequestErrorAsync(error, platform, accountName);
            });

          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildFreeTierIosLimitExceededError,
            'Error 1\nRun eas billing:subscribe starter --account test-account to upgrade to the Starter plan.'
          );
        });
      });

      describe('for VALIDATION_ERROR', () => {
        describe('with Android', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'VALIDATION_ERROR');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError = await getErrorAsync<RequestValidationError>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              RequestValidationError,
              'Error 1'
            );
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'VALIDATION_ERROR');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError = await getErrorAsync<RequestValidationError>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              RequestValidationError,
              'Error 1'
            );
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

            const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildDownForMaintenanceError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildDownForMaintenanceError,
              EXPECTED_EAS_BUILD_DOWN_MESSAGE
            );
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_DOWN_FOR_MAINTENANCE');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildDownForMaintenanceError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildDownForMaintenanceError,
              EXPECTED_EAS_BUILD_DOWN_MESSAGE
            );
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

            const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildTooManyPendingBuildsError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildTooManyPendingBuildsError,
              EXPECTED_MAX_BUILD_COUNT_MESSAGE_ANDROID
            );
          });
        });
        describe('with iOS', () => {
          it('throws correct EasCommandError subclass', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'EAS_BUILD_TOO_MANY_PENDING_BUILDS');
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });

            const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildTooManyPendingBuildsError>(
              async () => {
                await handleBuildRequestErrorAsync(error, platform);
              }
            );

            assertReThrownError(
              handleBuildRequestErrorThrownError,
              EasBuildTooManyPendingBuildsError,
              EXPECTED_MAX_BUILD_COUNT_MESSAGE_IOS
            );
          });
        });
      });

      describe('for UNAUTHORIZED', () => {
        it('points to the permission grant and permissions.account.role in eas.json', async () => {
          const platform = Platform.ANDROID;
          const graphQLError = getGraphQLError(
            'Cannot create an EXPO_TOKEN for the job: the job requires the "Release Manager" role',
            'UNAUTHORIZED'
          );
          const error = new CombinedError({ graphQLErrors: [graphQLError] });

          const handleBuildRequestErrorThrownError = await getErrorAsync<EasBuildUnauthorizedError>(
            async () => {
              await handleBuildRequestErrorAsync(error, platform);
            }
          );

          assertReThrownError(
            handleBuildRequestErrorThrownError,
            EasBuildUnauthorizedError,
            'Cannot create an EXPO_TOKEN for the job: the job requires the "Release Manager" role\n' +
              `Request ID: ${mockRequestId}\n\n` +
              `Run ${chalk.bold(
                'eas whoami'
              )} to check the user you are logged in as and your permission grant. Run ${chalk.bold(
                'eas login'
              )} to change the user or permission grant.\n\n` +
              `If your build profile in eas.json uses ${chalk.bold(
                'permissions.account.role'
              )}, it may mean your credentials do not grant the requested role.`
          );
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
          const expectedMessage = `${EXPECTED_GENERIC_MESSAGE}\nRequest ID: ${mockRequestId}\nError message: Error 1`;

          const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
            await handleBuildRequestErrorAsync(error, platform);
          });

          assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
        });
        it('throws base Error class with message including all error messages if combined error has multiple GraphQL errors', async () => {
          const platform = Platform.ANDROID;
          const graphQLErrors = [
            getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR'),
            getGraphQLError('Error 2', 'OTHER_GRAPHQL_ERROR'),
            getGraphQLError('Error 3', 'YET_ANOTHER_GRAPHQL_ERROR'),
          ];
          const error = new CombinedError({ graphQLErrors });
          const expectedMessage =
            `${EXPECTED_GENERIC_MESSAGE}\n` +
            `Request ID: ${mockRequestId}\n` +
            'Error message: Error 1\n' +
            `Request ID: ${mockRequestId}\n` +
            'Error message: Error 2\n' +
            `Request ID: ${mockRequestId}\n` +
            'Error message: Error 3';

          const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
            await handleBuildRequestErrorAsync(error, platform);
          });

          assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
        });
        describe('without request ID', () => {
          it('throws base Error class with custom message without request ID line', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
            delete graphQLError.extensions.requestId;
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });
            const expectedMessage = `${EXPECTED_GENERIC_MESSAGE}\nError message: Error 1`;

            const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
          });
        });
        describe('with empty GraphQL errors and network response details', () => {
          it('throws base Error class with network and response details', async () => {
            const platform = Platform.ANDROID;
            const error = new CombinedError({
              graphQLErrors: [],
              networkError: new Error('Request failed: 400 (Bad Request)'),
              response: {
                status: 400,
                statusText: 'Bad Request',
                headers: {
                  get: (headerName: string) =>
                    headerName === 'expo-request-id' ? mockRequestId : null,
                },
              },
            });
            const expectedMessage =
              `${EXPECTED_GENERIC_MESSAGE}\n` +
              'Network error: Request failed: 400 (Bad Request)\n' +
              'Response status: 400 Bad Request\n' +
              `Request ID: ${mockRequestId}`;

            const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
          });

          it('logs network and response details to debug', async () => {
            const platform = Platform.ANDROID;
            const logDebugSpy = jest.spyOn(Log, 'debug');
            const error = new CombinedError({
              graphQLErrors: [],
              networkError: new Error('Request failed: 400 (Bad Request)'),
              response: {
                status: 400,
                statusText: 'Bad Request',
                headers: {
                  get: (headerName: string) =>
                    headerName === 'expo-request-id' ? mockRequestId : null,
                },
              },
            });

            try {
              await handleBuildRequestErrorAsync(error, platform);
            } catch {}

            expect(logDebugSpy).toBeCalledWith(expect.stringContaining('"graphQLErrors": []'));
            expect(logDebugSpy).toBeCalledWith(
              expect.stringContaining('"message": "[Network] Request failed: 400 (Bad Request)"')
            );
            expect(logDebugSpy).toBeCalledWith(
              expect.stringContaining('"message": "Request failed: 400 (Bad Request)"')
            );
            expect(logDebugSpy).toBeCalledWith(expect.stringContaining('"status": 400'));
            expect(logDebugSpy).toBeCalledWith(
              expect.stringContaining(`"expo-request-id": "${mockRequestId}"`)
            );
          });

          it('includes the request ID from the x-request-id header when expo-request-id is missing', async () => {
            const platform = Platform.ANDROID;
            const error = new CombinedError({
              graphQLErrors: [],
              networkError: new Error('Request failed: 400 (Bad Request)'),
              response: {
                status: 400,
                statusText: 'Bad Request',
                headers: {
                  get: (headerName: string) =>
                    headerName === 'x-request-id' ? mockRequestId : null,
                },
              },
            });
            const expectedMessage =
              `${EXPECTED_GENERIC_MESSAGE}\n` +
              'Network error: Request failed: 400 (Bad Request)\n' +
              'Response status: 400 Bad Request\n' +
              `Request ID: ${mockRequestId}`;

            const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
          });
        });
        describe('with the same request ID in GraphQL error extensions and response headers', () => {
          it('does not duplicate the request ID line', async () => {
            const platform = Platform.ANDROID;
            const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
            const error = new CombinedError({
              graphQLErrors: [graphQLError],
              response: {
                status: 400,
                statusText: 'Bad Request',
                headers: {
                  get: (headerName: string) =>
                    headerName === 'expo-request-id' ? mockRequestId : null,
                },
              },
            });
            const expectedMessage =
              `${EXPECTED_GENERIC_MESSAGE}\n` +
              `Request ID: ${mockRequestId}\n` +
              'Error message: Error 1\n' +
              'Response status: 400 Bad Request';

            const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
          });
        });
        describe('with no GraphQL, network, or response details', () => {
          it('falls back to the top-level error message', async () => {
            const platform = Platform.ANDROID;
            const error = { graphQLErrors: [], message: 'Something went wrong' };
            const expectedMessage = `${EXPECTED_GENERIC_MESSAGE}\nError message: Something went wrong`;

            const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
          });
        });
      });
      describe('with iOS', () => {
        it('throws base Error class with custom message', async () => {
          const platform = Platform.IOS;
          const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
          const graphQLErrors = [graphQLError];
          const error = new CombinedError({ graphQLErrors });
          const expectedMessage = `${EXPECTED_GENERIC_MESSAGE}\nRequest ID: ${mockRequestId}\nError message: Error 1`;

          const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
            await handleBuildRequestErrorAsync(error, platform);
          });

          assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
        });
        it('throws base Error class with message including all error messages if combined error has multiple GraphQL errors', async () => {
          const platform = Platform.IOS;
          const graphQLErrors = [
            getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR'),
            getGraphQLError('Error 2', 'OTHER_GRAPHQL_ERROR'),
            getGraphQLError('Error 3', 'YET_ANOTHER_GRAPHQL_ERROR'),
          ];
          const error = new CombinedError({ graphQLErrors });
          const expectedMessage =
            `${EXPECTED_GENERIC_MESSAGE}\n` +
            `Request ID: ${mockRequestId}\n` +
            'Error message: Error 1\n' +
            `Request ID: ${mockRequestId}\n` +
            'Error message: Error 2\n' +
            `Request ID: ${mockRequestId}\n` +
            'Error message: Error 3';

          const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
            await handleBuildRequestErrorAsync(error, platform);
          });

          assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
        });
        describe('without request ID', () => {
          it('throws base Error class with custom message without request ID line', async () => {
            const platform = Platform.IOS;
            const graphQLError = getGraphQLError('Error 1', 'UNKNOWN_GRAPHQL_ERROR');
            delete graphQLError.extensions.requestId;
            const graphQLErrors = [graphQLError];
            const error = new CombinedError({ graphQLErrors });
            const expectedMessage = `${EXPECTED_GENERIC_MESSAGE}\nError message: Error 1`;

            const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
              await handleBuildRequestErrorAsync(error, platform);
            });

            assertReThrownError(handleBuildRequestErrorThrownError, Error, expectedMessage);
          });
        });
      });
    });

    describe('error is unexpected non-graphQL-related error', () => {
      describe('with Android', () => {
        it('throws base Error class with propagated message', async () => {
          const platform = Platform.ANDROID;
          const error = new Error('Non-graphQL-related error');

          const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
            await handleBuildRequestErrorAsync(error, platform);
          });

          expect(handleBuildRequestErrorThrownError).toStrictEqual(error);
        });
      });
      describe('with iOS', () => {
        it('throws base Error class with propagated message', async () => {
          const platform = Platform.IOS;
          const error = new Error('Non-graphQL-related error');

          const handleBuildRequestErrorThrownError = await getErrorAsync<Error>(async () => {
            await handleBuildRequestErrorAsync(error, platform);
          });

          expect(handleBuildRequestErrorThrownError).toStrictEqual(error);
        });
      });
    });
  });
});
