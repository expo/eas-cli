import { ExpoConfig } from '@expo/config';
import { App, User, UserRole } from '@expo/apple-utils';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Analytics } from '../analytics/AnalyticsManager';
import EasCommand from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CredentialsContext } from '../credentials/context';
import { AppStoreApiKeyPurpose } from '../credentials/ios/actions/AscApiKeyUtils';
import { getAppFromContextAsync } from '../credentials/ios/actions/BuildCredentialsUtils';
import { SetUpAscApiKey } from '../credentials/ios/actions/SetUpAscApiKey';
import { SetUpBuildCredentials } from '../credentials/ios/actions/SetUpBuildCredentials';
import { SetUpPushKey } from '../credentials/ios/actions/SetUpPushKey';
import { ensureAppExistsAsync } from '../credentials/ios/appstore/ensureAppExists';
import { Target } from '../credentials/ios/types';
import {
  WorkflowJobStatus,
  WorkflowProjectSourceType,
  WorkflowRunStatus,
} from '../graphql/generated';
import { getWorkflowRunUrl } from '../build/utils/url';
import { AppMutation } from '../graphql/mutations/AppMutation';
import { WorkflowRunMutation } from '../graphql/mutations/WorkflowRunMutation';
import { WorkflowRunQuery } from '../graphql/queries/WorkflowRunQuery';
import Log, { learnMore } from '../log';
import { confirmAsync } from '../prompts';
import { ora } from '../ora';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { uploadAccountScopedFileAsync } from '../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../project/uploadAccountScopedProjectSourceAsync';
import { Actor, getActorDisplayName } from '../user/User';
import { sleepAsync } from '../utils/promise';
import { Client } from '../vcs/vcs';
import NoVcsClient from '../vcs/clients/noVcs';
import {
  INVALID_BUNDLE_IDENTIFIER_MESSAGE,
  isBundleIdentifierValid,
} from '../project/ios/bundleIdentifier';

function deriveBundleIdSlug(bundleId: string): string {
  return bundleId.split('.').filter(Boolean).pop()!;
}

const TESTFLIGHT_GROUP_NAME = 'Team (Expo)';

async function setupTestFlightAsync(ascApp: App): Promise<void> {
  let group;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const groups = await ascApp.getBetaGroupsAsync({
        query: { includes: ['betaTesters'] },
      });

      group = groups.find(
        g => g.attributes.isInternalGroup && g.attributes.name === TESTFLIGHT_GROUP_NAME
      );

      if (!group) {
        group = await ascApp.createBetaGroupAsync({
          name: TESTFLIGHT_GROUP_NAME,
          isInternalGroup: true,
          hasAccessToAllBuilds: true,
        });
      }
      break;
    } catch (error: any) {
      // Apple returns this error when the app isn't ready yet
      if (error?.data?.errors?.some((e: any) => e.code === 'ENTITY_ERROR.RELATIONSHIP.INVALID')) {
        if (attempt < 9) {
          await sleepAsync(10_000);
          continue;
        }
      }
      throw error;
    }
  }

  if (!group) {
    throw new Error('Failed to create TestFlight group');
  }

  const users = await User.getAsync(ascApp.context);
  const admins = users.filter(u => u.attributes.roles?.includes(UserRole.ADMIN));

  const existingEmails = new Set(
    group.attributes.betaTesters?.map((t: any) => t.attributes.email?.toLowerCase()) ?? []
  );

  const newTesters = admins
    .filter(u => u.attributes.email && !existingEmails.has(u.attributes.email.toLowerCase()))
    .map(u => ({
      email: u.attributes.email!,
      firstName: u.attributes.firstName ?? '',
      lastName: u.attributes.lastName ?? '',
    }));

  if (newTesters.length > 0) {
    await group.createBulkBetaTesterAssignmentsAsync(newTesters);
  }
}

/* eslint-disable no-console */
async function withSuppressedOutputAsync<T>(fn: () => Promise<T>): Promise<T> {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  let capturedOutput = '';

  const capture = (chunk: any): boolean => {
    if (typeof chunk === 'string') {
      capturedOutput += chunk;
    }
    return true;
  };

  // Suppress stdout and console output during credential setup so its verbose
  // log lines don't interleave with our progress spinners.
  process.stdout.write = capture as any;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  let didThrow = false;
  try {
    return await fn();
  } catch (error) {
    didThrow = true;
    throw error;
  } finally {
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    if (didThrow && capturedOutput) {
      originalConsoleLog(capturedOutput);
    }
  }
}
/* eslint-enable no-console */

export default class Go extends EasCommand {
  static override description = 'Create a custom Expo Go and submit to TestFlight';
  static override hidden = true;

  static override flags = {
    'bundle-id': Flags.string({
      description: 'iOS bundle identifier (auto-generated if not provided)',
      required: false,
    }),
    name: Flags.string({
      description: 'App name',
      default: 'My Expo Go',
    }),
    'sdk-version': Flags.string({
      description: 'Expo Go SDK version to prepare (default: latest)',
      required: false,
    }),
    credentials: Flags.boolean({
      description: 'Interactively select credentials (default: auto-select)',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
  };

  async runAsync(): Promise<void> {
    Log.log(
      chalk.bold(
        `Creating your personal Expo Go and deploying to TestFlight. ${learnMore('https://expo.fyi/deploy-expo-go-testflight')}`
      )
    );

    const { flags } = await this.parse(Go);

    const {
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(Go, {
      nonInteractive: false,
    });
    Log.withTick(`Logged in as ${chalk.cyan(getActorDisplayName(actor))}`);

    const sdkVersion = flags['sdk-version'];
    const bundleId = flags['bundle-id'] ?? this.generateBundleId(actor);
    if (!isBundleIdentifierValid(bundleId)) {
      throw new Error(
        `"${bundleId}" is not a valid iOS bundle identifier. ${INVALID_BUNDLE_IDENTIFIER_MESSAGE} Pass a valid identifier with --bundle-id.`
      );
    }
    const appName = flags.name;
    const slug = deriveBundleIdSlug(bundleId);

    const setupSpinner = ora('Setting up project...').start();
    let projectId: string;
    try {
      projectId = await withSuppressedOutputAsync(() =>
        this.ensureEasProjectAsync(graphqlClient, actor, slug)
      );
    } catch (error) {
      setupSpinner.fail();
      throw error;
    }

    const tmpDir = path.join(os.tmpdir(), `eas-go-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    const vcsClient = new NoVcsClient({ cwdOverride: tmpDir });

    try {
      const ascApp = await this.setupCredentialsAsync(
        slug,
        projectId,
        bundleId,
        appName,
        graphqlClient,
        actor,
        analytics,
        vcsClient,
        flags.credentials,
        () => {
          setupSpinner.stop();
          Log.markFreshLine();
        }
      );

      const { workflowUrl, workflowRunId } = await this.dispatchWorkflowAsync(
        graphqlClient,
        projectId,
        actor,
        bundleId,
        appName,
        ascApp.id,
        sdkVersion,
        tmpDir,
        vcsClient
      );
      Log.withTick(`Build started: ${chalk.cyan(workflowUrl)}`);

      const status = await this.monitorWorkflowJobsAsync(graphqlClient, workflowRunId);
      if (status === WorkflowRunStatus.Failure) {
        throw new Error('Build failed');
      } else if (status === WorkflowRunStatus.Canceled) {
        throw new Error('Build was canceled');
      }

      try {
        await setupTestFlightAsync(ascApp);
      } catch (e) {
        Log.debug('TestFlight group setup failed (non-fatal):', e);
      }

      Log.newLine();
      Log.succeed(
        `Done! Your custom Expo Go has been submitted to TestFlight. ${learnMore(
          `https://appstoreconnect.apple.com/apps/${ascApp.id}/testflight`,
          { learnMoreMessage: 'Open it on App Store Connect' }
        )}`
      );
      Log.log(
        `App Store processing may take several minutes to complete. ${learnMore(
          'https://expo.fyi/personal-expo-go',
          { learnMoreMessage: 'Learn more about Expo Go on TestFlight' }
        )}`
      );
    } finally {
      await fs.remove(tmpDir);
    }
  }

  private generateBundleId(actor: Actor): string {
    const username = actor.accounts[0].name;
    const sanitizedUsername = username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!sanitizedUsername) {
      throw new Error(
        `Could not generate a bundle identifier from account name "${username}". Pass a valid identifier with --bundle-id.`
      );
    }
    return `com.${sanitizedUsername}.expogo`;
  }

  private async ensureEasProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    actor: Actor,
    slug: string
  ): Promise<string> {
    const account = actor.accounts[0];

    const existingProjectId = await findProjectIdByAccountNameAndSlugNullableAsync(
      graphqlClient,
      account.name,
      slug
    );

    if (existingProjectId) {
      return existingProjectId;
    }

    return await AppMutation.createAppAsync(graphqlClient, {
      accountId: account.id,
      projectName: slug,
    });
  }

  private async setupCredentialsAsync(
    slug: string,
    projectId: string,
    bundleId: string,
    appName: string,
    graphqlClient: ExpoGraphqlClient,
    actor: Actor,
    analytics: Analytics,
    vcsClient: Client,
    customizeCreds: boolean,
    onBeforeAppleAuth?: () => void
  ): Promise<App> {
    const extensionBundleId = `${bundleId}.ExpoNotificationServiceExtension`;

    const exp: ExpoConfig = { name: appName, slug, ios: { bundleIdentifier: bundleId } };

    const credentialsCtx = new CredentialsContext({
      projectInfo: { exp, projectId },
      nonInteractive: false,
      autoAcceptCredentialReuse: !customizeCreds,
      projectDir: process.cwd(),
      user: actor,
      graphqlClient,
      analytics,
      vcsClient,
    });

    onBeforeAppleAuth?.();
    const userAuthCtx = await credentialsCtx.appStore.ensureUserAuthenticatedAsync();

    const app = await getAppFromContextAsync(credentialsCtx);

    const targets: Target[] = [
      {
        targetName: slug,
        bundleIdentifier: bundleId,
        entitlements: {},
      },
      {
        targetName: 'ExpoNotificationServiceExtension',
        bundleIdentifier: extensionBundleId,
        parentBundleIdentifier: bundleId,
        entitlements: {},
      },
    ];

    await new SetUpBuildCredentials({
      app,
      targets,
      distribution: 'store',
    }).runAsync(credentialsCtx);

    const appLookupParams = {
      ...app,
      bundleIdentifier: bundleId,
    };
    await new SetUpAscApiKey(appLookupParams, AppStoreApiKeyPurpose.SUBMISSION_SERVICE).runAsync(
      credentialsCtx
    );

    const ascApp = await ensureAppExistsAsync(userAuthCtx, {
      name: appName,
      bundleIdentifier: bundleId,
    });
    const setupPushKeyAction = new SetUpPushKey(appLookupParams);
    const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(credentialsCtx);
    if (!isPushKeySetup) {
      if (customizeCreds) {
        const wantsPushNotifications = await confirmAsync({
          message: 'Would you like to set up Push Notifications for your app?',
          initial: true,
        });
        if (wantsPushNotifications) {
          await setupPushKeyAction.runAsync(credentialsCtx);
        }
      } else {
        await setupPushKeyAction.runAsync(credentialsCtx);
      }
    }

    return ascApp;
  }

  private async dispatchWorkflowAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string,
    actor: Actor,
    bundleId: string,
    appName: string,
    ascAppId: string,
    sdkVersion: string | undefined,
    tmpDir: string,
    vcsClient: Client
  ): Promise<{ workflowUrl: string; workflowRunId: string }> {
    const account = actor.accounts[0];

    const repackConfig = await WorkflowRunQuery.expoGoRepackConfigurationAsync(graphqlClient, {
      appId: projectId,
      ascAppId,
      appName,
      bundleId,
      sdkVersion,
    });

    await Promise.all(
      repackConfig.files.map(f => fs.writeFile(path.join(tmpDir, f.fileName), f.fileContents))
    );

    const { projectArchiveBucketKey, easJsonBucketKey, packageJsonBucketKey } =
      await withSuppressedOutputAsync(async () => {
        const { projectArchiveBucketKey } = await uploadAccountScopedProjectSourceAsync({
          graphqlClient,
          vcsClient,
          accountId: account.id,
        });
        const { fileBucketKey: easJsonBucketKey } = await uploadAccountScopedFileAsync({
          graphqlClient,
          accountId: account.id,
          filePath: path.join(tmpDir, 'eas.json'),
          maxSizeBytes: 1024 * 1024,
        });
        const { fileBucketKey: packageJsonBucketKey } = await uploadAccountScopedFileAsync({
          graphqlClient,
          accountId: account.id,
          filePath: path.join(tmpDir, 'package.json'),
          maxSizeBytes: 1024 * 1024,
        });
        return { projectArchiveBucketKey, easJsonBucketKey, packageJsonBucketKey };
      });

    const result = await WorkflowRunMutation.createExpoGoRepackWorkflowRunAsync(graphqlClient, {
      appId: projectId,
      sdkVersion: repackConfig.sdkVersion,
      projectSource: {
        type: WorkflowProjectSourceType.Gcs,
        projectArchiveBucketKey,
        easJsonBucketKey,
        packageJsonBucketKey,
      },
    });

    const workflowUrl = getWorkflowRunUrl(account.name, deriveBundleIdSlug(bundleId), result.id);

    return { workflowUrl, workflowRunId: result.id };
  }

  private async monitorWorkflowJobsAsync(
    graphqlClient: ExpoGraphqlClient,
    workflowRunId: string
  ): Promise<WorkflowRunStatus> {
    const EXPECTED_BUILD_DURATION_SECONDS = 5 * 60;
    const EXPECTED_SUBMIT_DURATION_SECONDS = 2 * 60;
    const buildStartTime = Date.now();
    let submitStartTime: number | null = null;

    const buildSpinner = ora(
      this.formatSpinnerText('Building Expo Go', EXPECTED_BUILD_DURATION_SECONDS, buildStartTime)
    ).start();
    let submitSpinner: ReturnType<typeof ora> | null = null;
    let buildCompleted = false;
    let failedFetchesCount = 0;

    while (true) {
      if (!buildCompleted) {
        buildSpinner.text = this.formatSpinnerText(
          'Building Expo Go',
          EXPECTED_BUILD_DURATION_SECONDS,
          buildStartTime
        );
      }
      if (submitSpinner && submitStartTime) {
        submitSpinner.text = this.formatSpinnerText(
          'Submitting to TestFlight',
          EXPECTED_SUBMIT_DURATION_SECONDS,
          submitStartTime
        );
      }

      try {
        const workflowRun = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, workflowRunId, {
          useCache: false,
        });
        failedFetchesCount = 0;

        const repackJob = workflowRun.jobs.find(j => j.key === 'build');
        const submitJob = workflowRun.jobs.find(j => j.key === 'submit');

        if (!buildCompleted) {
          if (repackJob?.status === WorkflowJobStatus.Success) {
            buildSpinner.succeed('Built Expo Go');
            buildCompleted = true;
          } else if (
            repackJob?.status === WorkflowJobStatus.Failure ||
            repackJob?.status === WorkflowJobStatus.Canceled
          ) {
            buildSpinner.fail('Build failed');
            return WorkflowRunStatus.Failure;
          }
        }

        if (buildCompleted && submitSpinner === null && submitJob) {
          submitStartTime = Date.now();
          submitSpinner = ora(
            this.formatSpinnerText(
              'Submitting to TestFlight',
              EXPECTED_SUBMIT_DURATION_SECONDS,
              submitStartTime
            )
          ).start();
        }

        if (workflowRun.status === WorkflowRunStatus.Success) {
          submitSpinner?.stop();
          return WorkflowRunStatus.Success;
        } else if (workflowRun.status === WorkflowRunStatus.Failure) {
          buildSpinner.stop();
          submitSpinner?.fail('Submission failed');
          return WorkflowRunStatus.Failure;
        } else if (workflowRun.status === WorkflowRunStatus.Canceled) {
          buildSpinner.stop();
          submitSpinner?.stop();
          return WorkflowRunStatus.Canceled;
        }
      } catch {
        failedFetchesCount++;
        if (failedFetchesCount > 6) {
          buildSpinner.fail();
          submitSpinner?.fail();
          throw new Error('Failed to fetch the workflow run status 6 times in a row');
        }
      }

      await sleepAsync(10 * 1000);
    }
  }

  private formatSpinnerText(
    label: string,
    expectedDurationSeconds: number,
    startTime: number
  ): string {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const remainingSeconds = Math.max(0, expectedDurationSeconds - elapsedSeconds);

    if (remainingSeconds === 0) {
      return `${label} (almost done...)`;
    }

    const minutes = Math.ceil(remainingSeconds / 60);
    const unit = minutes === 1 ? 'minute' : 'minutes';
    return `${label} (~${minutes} ${unit} remaining)`;
  }
}
