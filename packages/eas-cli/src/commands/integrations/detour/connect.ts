import { Flags } from '@oclif/core';
import chalk from 'chalk';
import os from 'os';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  parseEnvironmentFlag,
  resolveTargetEnvironmentsAsync,
} from '../../../environments/resolve';
import { upsertEnvVarAsync, upsertEnvVarsSequentiallyAsync } from '../../../environments/variables';
import { UserQuery } from '../../../graphql/queries/UserQuery';
import {
  DetourApiError,
  DetourApp,
  DetourMissingField,
  DetourSigningIdentity,
  MISSING_FIELD_PROMPTS,
  authorizeAsync,
  createAppAsync,
  describeMissingFields,
  findAppAsync,
  listAppsAsync,
  nonDefaultApiBaseUrl,
  parseFingerprint,
  updateSigningIdentityAsync,
} from '../../../integrations/detour/api';
import { collectSigningIdentityAsync } from '../../../integrations/detour/credentials';
import {
  DETOUR_ENV_LABEL,
  EAS_DETOUR_ENVIRONMENTS,
  createDetourEnvVars,
  detourEnvironmentCancelMessage,
  detourMoveConfirmMessage,
} from '../../../integrations/detour/env';
import {
  readConnection,
  removeFromAppConfigAsync,
  updateAppConfigAsync,
} from '../../../integrations/detour/linking';
import { writeEnvLocalAsync } from '../../../integrations/shared/envFile';
import { installSdkPackagesAsync } from '../../../integrations/shared/sdk';
import Log, { link } from '../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

// The SDK is JavaScript-only, so there is no config plugin to add.
const SDK_PACKAGES = [
  '@swmansion/react-native-detour',
  'expo-application',
  'expo-clipboard',
  'expo-constants',
  'expo-localization',
  'expo-device',
  '@react-native-async-storage/async-storage',
];

export default class IntegrationsDetourConnect extends EasCommand {
  static override description = 'connect Detour to your Expo project for deferred deep linking';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --environment preview',
    '<%= config.bin %> <%= command.id %> --app-id <app-id> --api-key <key> --non-interactive',
  ];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    'app-id': Flags.string({
      description:
        'Existing Detour App ID (Dashboard → API configuration). Skips the browser approval; requires --api-key',
      dependsOn: ['api-key'],
    }),
    'api-key': Flags.string({
      description: 'Publishable Detour API key that goes with --app-id',
      dependsOn: ['app-id'],
    }),
    // Sent with the signing identity, which only an approved connection writes.
    'team-id': Flags.string({
      description:
        'Apple Team ID, when EAS cannot tell which team signs this app (Apple Developer → Membership). Interactive runs only',
      exclusive: ['app-id'],
    }),
    'app-store-id': Flags.string({
      description:
        'App Store Connect app id, when it is not pinned as ascAppId in the submit profile. Interactive runs only',
      exclusive: ['app-id'],
    }),
    'play-signing-cert': Flags.string({
      description:
        'SHA-256 fingerprint of the Play App Signing certificate (Play Console → App integrity). EAS does not have it, and store builds are signed with it. Interactive runs only',
      exclusive: ['app-id'],
    }),
    'skip-app-config': Flags.boolean({
      description:
        "Don't add the Detour link domain to ios.associatedDomains and android.intentFilters",
      default: false,
    }),
    overwrite: Flags.boolean({
      description: 'Replace existing EXPO_PUBLIC_DETOUR_* in .env.local and EAS without prompting',
      default: false,
    }),
    environment: Flags.string({
      description: `EAS environments to write the variables to (default: ${EAS_DETOUR_ENVIRONMENTS.join(', ')})`,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsDetourConnect);
    const {
      'app-id': appIdFlag,
      'api-key': apiKeyFlag,
      'skip-app-config': skipAppConfig,
      'team-id': teamIdFlag,
      'app-store-id': appStoreIdFlag,
      'play-signing-cert': playSigningCert,
      overwrite,
      environment: environmentFlag,
    } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const productionCertificate = playSigningCert
      ? (parseFingerprint(playSigningCert) ?? undefined)
      : undefined;
    if (playSigningCert && !productionCertificate) {
      throw new Error(
        '--play-signing-cert must be a SHA-256 fingerprint: 32 hex bytes. Copying the value straight out of Play Console is fine.'
      );
    }
    if (appStoreIdFlag && !/^\d+$/.test(appStoreIdFlag.trim())) {
      throw new Error('--app-store-id must be digits only, e.g. 1234567891.');
    }
    const requestedEnvironments = parseEnvironmentFlag(environmentFlag);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, projectDir, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsDetourConnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const targetEnvironments = await resolveTargetEnvironmentsAsync(
      graphqlClient,
      projectId,
      requestedEnvironments ?? EAS_DETOUR_ENVIRONMENTS,
      nonInteractive,
      {
        defaultEnvironments: EAS_DETOUR_ENVIRONMENTS,
        cancelMessage: detourEnvironmentCancelMessage,
      }
    );

    const stagingUrl = nonDefaultApiBaseUrl();
    if (stagingUrl) {
      Log.warn(`Using Detour at ${stagingUrl}`);
    }

    if (!exp.ios?.bundleIdentifier && !exp.android?.package) {
      Log.warn(
        'This project has neither "ios.bundleIdentifier" nor "android.package". Detour cannot verify a link domain without them, so links will not open the app until you set them and re-run.'
      );
    }

    const manualSteps: string[] = [];
    let app: DetourApp;

    if (appIdFlag && apiKeyFlag) {
      // No approval means no organization, so no link host and no dashboard link.
      app = {
        appId: appIdFlag,
        name: exp.name ?? appIdFlag,
        apiKey: apiKeyFlag,
        linkHost: '',
        dashboardUrl: '',
      };
      manualSteps.push(
        'Copy the app.json snippets from Dashboard → App configuration to set up Universal Links and App Links.'
      );
    } else {
      app = await this.connectAsync(graphqlClient, {
        projectId,
        exp,
        nonInteractive,
        skipAppConfig,
        productionCertificate,
        teamIdFlag,
        appStoreIdFlag,
        projectDir,
        manualSteps,
      });
    }

    assertPublishableKey(app);

    const installResult = await installSdkPackagesAsync(projectDir, {
      packages: SDK_PACKAGES,
      label: DETOUR_ENV_LABEL,
      jsonFlag,
    });
    if (installResult.status === 'failed') {
      manualSteps.push(
        `The Detour SDK packages didn't install. Run npx expo install ${SDK_PACKAGES.join(' ')} from your project directory.`
      );
    }

    const envVars = createDetourEnvVars(app.appId, app.apiKey);
    await writeEnvLocalAsync(projectDir, envVars, {
      label: DETOUR_ENV_LABEL,
      nonInteractive,
      overwrite,
    });
    await upsertEnvVarsSequentiallyAsync(envVars, envVar =>
      upsertEnvVarAsync(
        graphqlClient,
        projectId,
        envVar,
        targetEnvironments,
        nonInteractive,
        overwrite,
        {
          mode: 'replaceOtherEnvironments',
          moveConfirmMessage: detourMoveConfirmMessage,
        }
      )
    );

    if (jsonFlag) {
      printJsonOnlyOutput({ app, environments: targetEnvironments, manualSteps });
      return;
    }

    Log.newLine();
    for (const step of manualSteps) {
      Log.warn(step);
    }
    Log.log(
      app.linkHost
        ? `Detour app ${chalk.bold(app.name)} is connected. Links resolve from ${chalk.bold(app.linkHost)}.`
        : `Detour app ${chalk.bold(app.name)} is connected.`
    );
    if (app.dashboardUrl) {
      Log.log(`Dashboard: ${link(app.dashboardUrl)}`);
    }
    Log.newLine();
    Log.log(
      'Next: wrap your app in <DetourProvider>, then create a development build to test link resolution.'
    );
  }

  private async connectAsync(
    graphqlClient: Parameters<typeof collectSigningIdentityAsync>[0],
    {
      projectId,
      exp,
      nonInteractive,
      skipAppConfig,
      productionCertificate,
      teamIdFlag,
      appStoreIdFlag,
      projectDir,
      manualSteps,
    }: {
      projectId: string;
      exp: Parameters<typeof collectSigningIdentityAsync>[1];
      nonInteractive: boolean;
      skipAppConfig: boolean;
      productionCertificate?: string;
      teamIdFlag?: string;
      appStoreIdFlag?: string;
      projectDir: string;
      manualSteps: string[];
    }
  ): Promise<DetourApp> {
    const actor = await UserQuery.currentUserAsync(graphqlClient);
    const emailHint = actor && 'email' in actor ? (actor.email ?? undefined) : undefined;

    const { deviceCode } = await authorizeAsync({
      emailHint,
      deviceLabel: os.hostname(),
      nonInteractive,
    });

    const connection = readConnection(exp);
    let app: DetourApp;
    let appConfigStep: string | null = null;
    let appConfigWritten = false;

    if (connection) {
      const existing = await findAppAsync(deviceCode, connection.appId);
      // Gone, or in another organization. Creating a second one would duplicate it.
      if (!existing) {
        throw new Error(
          `This project is already connected to Detour app ${connection.appId}, which is not in the organization you approved. ` +
            'Re-run and approve with the organization that owns it, or remove "extra.detour.appId" from your app config to connect a different app.'
        );
      }
      app = existing;
      Log.withTick(`Using existing Detour app ${chalk.bold(app.name)}`);
    } else {
      app = await resolveAppAsync(deviceCode, exp.name, { nonInteractive });
      // Before anything else can fail, or the app exists with nothing pointing at it.
      if (!skipAppConfig) {
        appConfigStep = await updateAppConfigAsync(projectDir, {
          linkHost: app.linkHost,
          appId: app.appId,
        });
        appConfigWritten = true;
      }
    }

    assertPublishableKey(app);

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    const signingIdentity = await collectSigningIdentityAsync(graphqlClient, exp, {
      accountName: account.name,
      projectDir,
    });
    // The server only fills blanks, so a dashboard edit survives.
    const { missing: missingFields, publishFailed } = await updateSigningIdentityAsync(
      deviceCode,
      app.appId,
      {
        ...signingIdentity,
        teamId: signingIdentity.teamId ?? teamIdFlag,
        appStoreId: signingIdentity.appStoreId ?? appStoreIdFlag,
        productionCertificate,
      }
    );
    // Asked rather than left to a re-run: the flags are invisible otherwise.
    const stillMissing = await promptForMissingFieldsAsync(deviceCode, app.appId, missingFields, {
      nonInteractive,
    });
    manualSteps.push(...describeMissingFields(stillMissing));
    if (publishFailed) {
      manualSteps.push(
        'Detour could not publish the link verification files for this app. Re-run this command; if it keeps failing, open the dashboard and save the App configuration screen.'
      );
    }

    const previousLinkHost =
      connection?.linkHost && app.linkHost && connection.linkHost !== app.linkHost
        ? connection.linkHost
        : undefined;

    if (previousLinkHost) {
      manualSteps.push(
        skipAppConfig
          ? `This Detour app now serves links from ${app.linkHost}, but your app config still points at ${previousLinkHost}. Update "ios.associatedDomains" and "android.intentFilters" by hand — the old host no longer verifies.`
          : `This Detour app now serves links from ${app.linkHost}. Its ${previousLinkHost} entries were replaced in your app config, so rebuild the app for the new domain to verify.`
      );
    }

    if (!skipAppConfig && !appConfigWritten) {
      // disconnect removes what extra.detour records, and that is about to change.
      if (previousLinkHost) {
        const removalStep = await removeFromAppConfigAsync(projectDir, {
          linkHost: previousLinkHost,
        });
        if (removalStep) {
          manualSteps.push(removalStep);
        }
      }
      appConfigStep = await updateAppConfigAsync(projectDir, {
        linkHost: app.linkHost,
        appId: app.appId,
      });
    }
    if (appConfigStep) {
      manualSteps.push(appConfigStep);
    }

    return app;
  }
}

function assertPublishableKey(app: DetourApp): asserts app is DetourApp & { apiKey: string } {
  if (!app.apiKey) {
    throw new Error(
      `Detour app ${app.appId} has no active publishable key. Generate one in the dashboard and re-run.`
    );
  }
}

/** Returns whatever is still missing after the extra write. */
async function promptForMissingFieldsAsync(
  deviceCode: string,
  appId: string,
  missing: DetourMissingField[],
  { nonInteractive }: { nonInteractive: boolean }
): Promise<DetourMissingField[]> {
  const askable = missing.filter(
    (field): field is keyof typeof MISSING_FIELD_PROMPTS => field in MISSING_FIELD_PROMPTS
  );
  if (nonInteractive || askable.length === 0) {
    return missing;
  }

  Log.newLine();
  Log.log('Link verification needs a few values EAS does not have:');
  for (const field of askable) {
    Log.log(`  ${MISSING_FIELD_PROMPTS[field].message} — ${MISSING_FIELD_PROMPTS[field].hint}`);
  }
  if (!(await confirmAsync({ message: 'Enter them now?' }))) {
    return missing;
  }

  const collected: DetourSigningIdentity = {};
  for (const field of askable) {
    const { message, parse } = MISSING_FIELD_PROMPTS[field];
    const { value } = await promptAsync({
      type: 'text',
      name: 'value',
      message: `${message} (leave empty to skip)`,
      validate: (input: string) =>
        !input.trim() || parse(input) !== null || `That is not a valid ${message}.`,
    });
    const parsed = value?.trim() ? parse(value) : null;
    if (parsed) {
      collected[field] = parsed;
    }
  }

  if (Object.keys(collected).length === 0) {
    return missing;
  }
  const { missing: remaining } = await updateSigningIdentityAsync(deviceCode, appId, collected);
  return remaining;
}

/**
 * A project with no recorded connection may still belong to an app someone made
 * in the dashboard, so the organization's apps are offered before creating one.
 */
async function resolveAppAsync(
  deviceCode: string,
  projectName: string,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<DetourApp> {
  const existing = nonInteractive ? [] : await listAppsAsync(deviceCode);

  if (existing.length > 0) {
    // The app named after this project goes first: on a free plan, with one app
    // and one obvious answer, this is a single Enter.
    const sorted = [...existing].sort((a, b) =>
      a.name === projectName ? -1 : b.name === projectName ? 1 : 0
    );
    const choice = await selectAsync<string | null>('Which Detour app should this project use?', [
      ...sorted.map(app => ({ title: `${app.name} (${app.appId})`, value: app.appId })),
      { title: 'Create a new app', value: null },
    ]);

    if (choice) {
      const linked = await findAppAsync(deviceCode, choice);
      if (!linked) {
        throw new Error(`Detour app ${choice} could not be read back. Re-run the command.`);
      }
      Log.withTick(`Using existing Detour app ${chalk.bold(linked.name)}`);
      return linked;
    }
  }

  try {
    const created = await createAppAsync(deviceCode, projectName);
    Log.withTick(`Created Detour app ${chalk.bold(created.name)}`);
    return created;
  } catch (error) {
    // Added here, not by the server: the dashboard shows the same message.
    if (error instanceof DetourApiError && error.status === 409) {
      throw new Error(
        `${error.message} Rename the project, or re-run with --app-id and --api-key to use the existing app.`
      );
    }
    throw error;
  }
}
