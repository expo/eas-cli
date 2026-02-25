import { App, User, UserRole } from '@expo/apple-utils';
import spawnAsync from '@expo/spawn-async';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Analytics } from '../analytics/AnalyticsManager';
import EasCommand from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { saveProjectIdToAppConfigAsync } from '../commandUtils/context/contextUtils/getProjectIdAsync';
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
import { AppMutation } from '../graphql/mutations/AppMutation';
import { WorkflowRunMutation } from '../graphql/mutations/WorkflowRunMutation';
import { AppQuery } from '../graphql/queries/AppQuery';
import { WorkflowRunQuery } from '../graphql/queries/WorkflowRunQuery';
import Log, { learnMore } from '../log';
import { confirmAsync } from '../prompts';
import { ora } from '../ora';
import { getPrivateExpoConfigAsync } from '../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { uploadAccountScopedFileAsync } from '../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../project/uploadAccountScopedProjectSourceAsync';
import { Actor, getActorDisplayName } from '../user/User';
import { sleepAsync } from '../utils/promise';
import { resolveVcsClient } from '../vcs';
import { Client as VcsClient } from '../vcs/vcs';

// Expo Go release info - update when releasing a new version
const EXPO_GO_SDK_VERSION = '55';
const EXPO_GO_APP_VERSION = '55.0.11';
const EXPO_GO_BUILD_NUMBER = '1017799';

const TESTFLIGHT_GROUP_NAME = 'Team (Expo)';

async function setupTestFlightAsync(ascApp: App): Promise<void> {
  // Create or get TestFlight group
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
          await new Promise(resolve => setTimeout(resolve, 10000));
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

  // Only suppress stdout, not stderr — ora writes spinner frames to stderr and
  // patching it would freeze the spinner animation during suppressed async work.
  process.stdout.write = capture as any;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  try {
    return await fn();
  } catch (error) {
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    if (capturedOutput) {
      originalConsoleLog(capturedOutput);
    }
    throw error;
  } finally {
    process.stdout.write = originalStdoutWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
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
        `Creating your personal Expo Go and deploying to TestFlight. ${learnMore('https://expo.fyi/personal-expo-go')}`
      )
    );

    const { flags } = await this.parse(Go);

    const spinner = ora('Logging in to Expo...').start();
    const {
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(Go, {
      nonInteractive: false,
    });
    spinner.succeed(`Logged in as ${chalk.cyan(getActorDisplayName(actor))}`);

    const bundleId = flags['bundle-id'] ?? this.generateBundleId(actor);
    const appName = flags.name ?? 'My Expo Go';
    const slug = bundleId.split('.').pop() || 'my-expo-go';

    const projectDir = path.join(os.tmpdir(), `eas-go-${slug}`);
    await fs.emptyDir(projectDir);

    const originalCwd = process.cwd();
    process.chdir(projectDir);

    const setupSpinner = ora('Creating project...').start();

    // Step 1: Create project files and initialize git (silently)
    try {
      await withSuppressedOutputAsync(async () => {
        await this.createProjectFilesAsync(projectDir, bundleId, appName);
        await this.initGitRepoAsync(projectDir);
      });
      const vcsClient = resolveVcsClient();

      // Step 2: Create/link EAS project (silently)
      const projectId = await withSuppressedOutputAsync(() =>
        this.ensureEasProjectAsync(graphqlClient, actor, projectDir, bundleId)
      );

      // Step 3: Set up iOS credentials and create App Store Connect app
      const ascApp = await this.setupCredentialsAsync(
        projectDir,
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

      // Step 4: Start workflow and monitor progress
      const { workflowUrl, workflowRunId } = await this.runWorkflowAsync(
        graphqlClient,
        projectDir,
        projectId,
        actor,
        vcsClient
      );
      Log.withTick(`Workflow started: ${chalk.cyan(workflowUrl)}`);

      const status = await this.monitorWorkflowJobsAsync(graphqlClient, workflowRunId);
      if (status === WorkflowRunStatus.Failure) {
        throw new Error('Workflow failed');
      } else if (status === WorkflowRunStatus.Canceled) {
        throw new Error('Workflow was canceled');
      }

      // Step 5: Set up TestFlight group (silently)
      try {
        await setupTestFlightAsync(ascApp);
      } catch {
        // Non-fatal: TestFlight group setup failure shouldn't block the user
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

      await fs.remove(projectDir);
    } catch (error) {
      Log.gray(`Project files preserved for debugging: ${projectDir}`);
      throw error;
    } finally {
      process.chdir(originalCwd);
    }
  }

  private generateBundleId(actor: Actor): string {
    const username = actor.accounts[0].name;
    // Sanitize username for bundle ID: only alphanumeric and hyphens allowed
    const sanitizedUsername = username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
    // Deterministic bundle ID per user + SDK version (reuses same ASC app)
    return `com.${sanitizedUsername || 'app'}.expogo${EXPO_GO_SDK_VERSION}`;
  }

  private async createProjectFilesAsync(
    projectDir: string,
    bundleId: string,
    appName: string
  ): Promise<void> {
    const slug = bundleId.split('.').pop() || 'custom-expo-go';
    const extensionBundleId = `${bundleId}.ExpoNotificationServiceExtension`;

    const appJson = {
      expo: {
        name: appName,
        slug,
        version: EXPO_GO_APP_VERSION,
        ios: {
          bundleIdentifier: bundleId,
          buildNumber: EXPO_GO_BUILD_NUMBER,
          config: {
            usesNonExemptEncryption: false,
          },
        },
        extra: {
          eas: {
            build: {
              experimental: {
                ios: {
                  appExtensions: [
                    {
                      targetName: 'ExpoNotificationServiceExtension',
                      bundleIdentifier: extensionBundleId,
                    },
                  ],
                },
              },
            },
          },
        },
      },
    };

    const easJson = {
      cli: {
        version: '>= 5.0.0',
      },
      build: {
        production: {
          distribution: 'store',
          credentialsSource: 'remote',
        },
      },
      submit: {
        production: {
          ios: {},
        },
      },
    };

    const packageJson = {
      name: slug,
      version: '1.0.0',
      dependencies: {
        expo: '~54.0.0',
      },
    };

    await fs.writeJson(path.join(projectDir, 'app.json'), appJson, { spaces: 2 });
    await fs.writeJson(path.join(projectDir, 'eas.json'), easJson, { spaces: 2 });
    await fs.writeJson(path.join(projectDir, 'package.json'), packageJson, { spaces: 2 });

    await spawnAsync('npm', ['install'], { cwd: projectDir });
  }

  private async initGitRepoAsync(projectDir: string): Promise<void> {
    await spawnAsync('git', ['init'], { cwd: projectDir });
    await spawnAsync('git', ['add', '.'], { cwd: projectDir });
    await spawnAsync('git', ['commit', '-m', 'Initial commit'], { cwd: projectDir });
  }

  private async ensureEasProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    actor: Actor,
    projectDir: string,
    bundleId: string
  ): Promise<string> {
    const slug = bundleId.split('.').pop() || 'custom-expo-go';
    const account = actor.accounts[0];

    const existingProjectId = await findProjectIdByAccountNameAndSlugNullableAsync(
      graphqlClient,
      account.name,
      slug
    );

    if (existingProjectId) {
      await saveProjectIdToAppConfigAsync(projectDir, existingProjectId);
      return existingProjectId;
    }

    const projectId = await AppMutation.createAppAsync(graphqlClient, {
      accountId: account.id,
      projectName: slug,
    });
    await saveProjectIdToAppConfigAsync(projectDir, projectId);
    return projectId;
  }

  private async setupCredentialsAsync(
    projectDir: string,
    projectId: string,
    bundleId: string,
    appName: string,
    graphqlClient: ExpoGraphqlClient,
    actor: Actor,
    analytics: Analytics,
    vcsClient: VcsClient,
    customizeCreds: boolean,
    onBeforeAppleAuth?: () => void
  ): Promise<App> {
    const exp = await getPrivateExpoConfigAsync(projectDir);
    const extensionBundleId = `${bundleId}.ExpoNotificationServiceExtension`;

    const credentialsCtx = new CredentialsContext({
      projectInfo: { exp, projectId },
      nonInteractive: false,
      autoAcceptCredentialReuse: !customizeCreds,
      projectDir,
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
        targetName: exp.slug,
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

    const ascApp = await withSuppressedOutputAsync(async () => {
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

      const ascAppResult = await ensureAppExistsAsync(userAuthCtx, {
        name: appName,
        bundleIdentifier: bundleId,
      });

      const easJsonPath = path.join(projectDir, 'eas.json');
      const easJson = await fs.readJson(easJsonPath);
      easJson.submit = easJson.submit || {};
      easJson.submit.production = easJson.submit.production || {};
      easJson.submit.production.ios = easJson.submit.production.ios || {};
      easJson.submit.production.ios.ascAppId = ascAppResult.id;
      await fs.writeJson(easJsonPath, easJson, { spaces: 2 });

      await spawnAsync('git', ['add', 'eas.json'], { cwd: projectDir });
      await spawnAsync('git', ['commit', '-m', 'Add ascAppId to eas.json'], { cwd: projectDir });

      return ascAppResult;
    });

    // Set up push notifications (outside suppressed block so prompts are visible)
    const appLookupParamsForPushKey = { ...app, bundleIdentifier: bundleId };
    const setupPushKeyAction = new SetUpPushKey(appLookupParamsForPushKey);
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

  private async runWorkflowAsync(
    graphqlClient: ExpoGraphqlClient,
    projectDir: string,
    projectId: string,
    actor: Actor,
    vcsClient: VcsClient
  ): Promise<{ workflowUrl: string; workflowRunId: string }> {
    const account = actor.accounts[0];

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
          filePath: path.join(projectDir, 'eas.json'),
          maxSizeBytes: 1024 * 1024,
        });

        const { fileBucketKey: packageJsonBucketKey } = await uploadAccountScopedFileAsync({
          graphqlClient,
          accountId: account.id,
          filePath: path.join(projectDir, 'package.json'),
          maxSizeBytes: 1024 * 1024,
        });

        return { projectArchiveBucketKey, easJsonBucketKey, packageJsonBucketKey };
      });

    const { id: workflowRunId } = await WorkflowRunMutation.createExpoGoRepackWorkflowRunAsync(
      graphqlClient,
      {
        appId: projectId,
        projectSource: {
          type: WorkflowProjectSourceType.Gcs,
          projectArchiveBucketKey,
          easJsonBucketKey,
          packageJsonBucketKey,
          projectRootDirectory: '.',
        },
      }
    );

    const app = await AppQuery.byIdAsync(graphqlClient, projectId);
    const workflowUrl = `https://expo.dev/accounts/${account.name}/projects/${app.slug}/workflows/${workflowRunId}`;

    return { workflowUrl, workflowRunId };
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

        const repackJob = workflowRun.jobs.find(j => j.name === 'Repack Expo Go');
        const submitJob = workflowRun.jobs.find(j => j.name === 'Submit to TestFlight');

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
