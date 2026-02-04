import { App, User, UserRole } from '@expo/apple-utils';
import spawnAsync from '@expo/spawn-async';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import prompts from 'prompts';

import { Analytics } from '../analytics/AnalyticsManager';
import EasCommand from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { saveProjectIdToAppConfigAsync } from '../commandUtils/context/contextUtils/getProjectIdAsync';
import { showWorkflowStatusAsync } from '../commandUtils/workflow/utils';
import { CredentialsContext } from '../credentials/context';
import { AppStoreApiKeyPurpose } from '../credentials/ios/actions/AscApiKeyUtils';
import { getAppFromContextAsync } from '../credentials/ios/actions/BuildCredentialsUtils';
import { SetUpAscApiKey } from '../credentials/ios/actions/SetUpAscApiKey';
import { SetUpBuildCredentials } from '../credentials/ios/actions/SetUpBuildCredentials';
import { ensureAppExistsAsync } from '../credentials/ios/appstore/ensureAppExists';
import { Target } from '../credentials/ios/types';
import { WorkflowProjectSourceType, WorkflowRunStatus } from '../graphql/generated';
import { AppMutation } from '../graphql/mutations/AppMutation';
import { WorkflowRevisionMutation } from '../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../graphql/mutations/WorkflowRunMutation';
import { AppQuery } from '../graphql/queries/AppQuery';
import Log from '../log';
import { ora } from '../ora';
import { getPrivateExpoConfigAsync } from '../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { uploadAccountScopedFileAsync } from '../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../project/uploadAccountScopedProjectSourceAsync';
import { Actor } from '../user/User';
import { resolveVcsClient } from '../vcs';
import { Client as VcsClient } from '../vcs/vcs';

// Expo Go release info - update all three when releasing a new version
const EXPO_GO_IPA_URL = 'https://expo.dev/artifacts/eas/gGwYvTqGd3rHWrbHDBfjDj.ipa';
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
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
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

  process.stdout.write = capture as any;
  process.stderr.write = capture as any;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  try {
    return await fn();
  } catch (error) {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    if (capturedOutput) {
      originalConsoleLog(capturedOutput);
    }
    throw error;
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
}
/* eslint-enable no-console */

const WORKFLOW_TEMPLATE = `name: Repack Expo Go

jobs:
  repack:
    name: Repack Expo Go
    type: build
    params:
      platform: ios
      profile: production
    steps:
      - uses: eas/checkout
      - uses: eas/use_npm_token
      - uses: eas/install_node_modules
      - uses: eas/resolve_build_config
      - id: download
        run: |
          curl --output expo-go.ipa -L ${EXPO_GO_IPA_URL}
          set-output ipa_path "$PWD/expo-go.ipa"
      - uses: eas/repack
        id: repack
        with:
          source_app_path: "\${{ steps.download.outputs.ipa_path }}"
          platform: ios
          embed_bundle_assets: false
          repack_package: "@kudo-chien/repack-app"
          repack_version: "0.3.1"
      - uses: eas/upload_artifact
        with:
          path: "\${{ steps.repack.outputs.output_path }}"

  submit:
    name: Submit to TestFlight
    type: submit
    needs: [repack]
    params:
      build_id: \${{ needs.repack.outputs.build_id }}
`;

export default class Go extends EasCommand {
  static override description = 'Create a custom Expo Go and submit to TestFlight';

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
    Log.log(chalk.bold('Creating your personal Expo Go...\n'));

    const { flags } = await this.parse(Go);

    let spinner = ora('Logging in to Expo...').start();
    const {
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(Go, {
      nonInteractive: false,
    });
    spinner.succeed(`Logged in as ${chalk.cyan(actor.accounts[0].name)}`);

    const bundleId = flags['bundle-id'] ?? this.generateBundleId(actor);
    const appName = flags.name ?? 'My Expo Go';
    const slug = bundleId.split('.').pop() || 'my-expo-go';

    const projectDir = path.join(os.tmpdir(), `eas-go-${slug}`);
    await fs.emptyDir(projectDir);

    const originalCwd = process.cwd();
    process.chdir(projectDir);

    Log.log(`Bundle ID: ${chalk.cyan(bundleId)}`);

    // Step 1: Create project files and initialize git
    try {
      spinner = ora('Creating project...').start();
      await withSuppressedOutputAsync(async () => {
        await this.createProjectFilesAsync(projectDir, bundleId, appName);
        await this.initGitRepoAsync(projectDir);
      });
      const vcsClient = resolveVcsClient();

      // Step 2: Create/link EAS project
      const projectId = await withSuppressedOutputAsync(() =>
        this.ensureEasProjectAsync(graphqlClient, actor, projectDir, bundleId)
      );
      spinner.succeed(
        `Project created: ${chalk.cyan(`@${actor.accounts[0].name}/${bundleId.split('.').pop()}`)}`
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
        flags.credentials
      );

      Log.withTick('Credentials and App Store Connect configured');

      // Step 4: Run workflow
      const startTime = Date.now();
      spinner = ora('Starting workflow...').start();

      await this.runWorkflowAsync(graphqlClient, projectDir, projectId, actor, vcsClient, url => {
        spinner.succeed(`Workflow started: ${chalk.cyan(url)}`);
      });

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      Log.withTick(`Workflow completed in ${mins}:${secs.toString().padStart(2, '0')}`);

      // Step 5: Set up TestFlight group (after build is submitted)
      spinner = ora('Setting up TestFlight...').start();
      try {
        await setupTestFlightAsync(ascApp);
        spinner.succeed('TestFlight configured');
      } catch (error: any) {
        spinner.fail(`Could not set up TestFlight group: ${error.message}`);
      }

      Log.newLine();
      Log.succeed('Done! Your custom Expo Go has been submitted to TestFlight.');
      Log.log(
        `App Store Connect: ${chalk.cyan(
          `https://appstoreconnect.apple.com/apps/${ascApp.id}/testflight`
        )}`
      );

      await fs.remove(projectDir);
    } catch (error) {
      spinner?.fail();
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

    const workflowDir = path.join(projectDir, '.eas', 'workflows');
    await fs.ensureDir(workflowDir);
    await fs.writeFile(path.join(workflowDir, 'repack.yml'), WORKFLOW_TEMPLATE);

    await spawnAsync('yarn', ['install'], { cwd: projectDir });
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
    customizeCreds: boolean
  ): Promise<App> {
    const exp = await getPrivateExpoConfigAsync(projectDir);
    const extensionBundleId = `${bundleId}.ExpoNotificationServiceExtension`;

    const credentialsCtx = new CredentialsContext({
      projectInfo: { exp, projectId },
      nonInteractive: false,
      projectDir,
      user: actor,
      graphqlClient,
      analytics,
      vcsClient,
      easJsonCliConfig: {
        promptToConfigurePushNotifications: false,
      },
    });

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

    if (!customizeCreds) {
      prompts.inject(Array(20).fill(true));
    }

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

    return ascApp;
  }

  private async runWorkflowAsync(
    graphqlClient: ExpoGraphqlClient,
    projectDir: string,
    projectId: string,
    actor: Actor,
    vcsClient: VcsClient,
    onWorkflowStarted?: (workflowUrl: string) => void
  ): Promise<string> {
    const account = actor.accounts[0];
    const workflowFile = path.join(projectDir, '.eas', 'workflows', 'repack.yml');
    const yamlConfig = await fs.readFile(workflowFile, 'utf-8');

    await WorkflowRevisionMutation.validateWorkflowYamlConfigAsync(graphqlClient, {
      appId: projectId,
      yamlConfig,
    });

    const { projectArchiveBucketKey, easJsonBucketKey, packageJsonBucketKey } =
      await withSuppressedOutputAsync(async () => {
        const { projectArchiveBucketKey } = await uploadAccountScopedProjectSourceAsync({
          graphqlClient,
          vcsClient,
          accountId: account.id,
        });

        const easJsonPath = path.join(projectDir, 'eas.json');
        const packageJsonPath = path.join(projectDir, 'package.json');

        const { fileBucketKey: easJsonBucketKey } = await uploadAccountScopedFileAsync({
          graphqlClient,
          accountId: account.id,
          filePath: easJsonPath,
          maxSizeBytes: 1024 * 1024,
        });

        const { fileBucketKey: packageJsonBucketKey } = await uploadAccountScopedFileAsync({
          graphqlClient,
          accountId: account.id,
          filePath: packageJsonPath,
          maxSizeBytes: 1024 * 1024,
        });

        return { projectArchiveBucketKey, easJsonBucketKey, packageJsonBucketKey };
      });

    const { id: workflowRunId } = await WorkflowRunMutation.createWorkflowRunAsync(graphqlClient, {
      appId: projectId,
      workflowRevisionInput: {
        fileName: 'repack.yml',
        yamlConfig,
      },
      workflowRunInput: {
        inputs: {},
        projectSource: {
          type: WorkflowProjectSourceType.Gcs,
          projectArchiveBucketKey,
          easJsonBucketKey,
          packageJsonBucketKey,
          projectRootDirectory: '.',
        },
      },
    });

    const app = await AppQuery.byIdAsync(graphqlClient, projectId);
    const workflowUrl = `https://expo.dev/accounts/${account.name}/projects/${app.slug}/workflows/${workflowRunId}`;

    onWorkflowStarted?.(workflowUrl);

    const { status } = await showWorkflowStatusAsync(graphqlClient, {
      workflowRunId,
      spinnerUsesStdErr: false,
    });

    if (status === WorkflowRunStatus.Failure) {
      throw new Error('Workflow failed');
    } else if (status === WorkflowRunStatus.Canceled) {
      throw new Error('Workflow was canceled');
    }

    return workflowUrl;
  }
}
