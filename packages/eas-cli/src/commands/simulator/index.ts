import { Flags } from '@oclif/core';
import nullthrows from 'nullthrows';

import {
  AnalyticsEventProperties,
  AnalyticsWithOrchestration,
  SimulatorEvent,
  isAnalyticsOptedOutAsync,
} from '../../analytics/AnalyticsManager';
import { getAgentTelemetryContext } from '../../analytics/agent';
import { getDeviceRunSessionPreviewUrl, getDeviceRunSessionUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import {
  AppPlatform,
  DeviceRunSessionEgress,
  DeviceRunSessionRequestOrigin,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  JobRunStatus,
  StatuspageServiceName,
} from '../../graphql/generated';
import { DeviceRunSessionMutation } from '../../graphql/mutations/DeviceRunSessionMutation';
import { DeviceRunSessionAvailabilityQuery } from '../../graphql/queries/DeviceRunSessionAvailabilityQuery';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log, { link } from '../../log';
import { Ora, ora } from '../../ora';
import { promptAsync } from '../../prompts';
import {
  SIMULATOR_HIDDEN_TOPIC_ALIASES,
  SIMULATOR_TOPIC_ALIASES,
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';
import {
  ControlConfigExecutionError,
  serializeControlConfigResults,
} from '../../simulator/controlConfig';
import { resolveStartConfigAsync } from '../../simulator/startConfig';
import { applyStartConfigAsync } from '../../simulator/startSetup';
import { parseEgressAllowList, runLocalEgressAsync } from '../../simulator/egress';
import { parseCorsOriginList, parseFrameAncestorList } from '../../simulator/frameAncestors';
import { parseNetworkCaptureFields } from '../../simulator/networkCapture';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
  resetSimulatorEnvAsync,
  writeSimulatorEnvAsync,
} from '../../simulator/env';
import { resolveExpoGoSdkVersionAsync } from '../../simulator/expoGo';
import {
  fetchSimulatorSessionErrorsAsync,
  formatSimulatorSessionError,
} from '../../simulator/jobRunErrors';
import {
  simulatorRequestFailureReason,
  simulatorRequestProperties,
} from '../../simulator/requestAnalytics';
import {
  DEVICE_RUN_SESSION_PLATFORM_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_PLATFORM_FLAG_VALUES,
  DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_RESOURCE_CLASS_FLAG_VALUES,
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_OPTIONS,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  DeviceRunSessionPlatformFlagValue,
  DeviceRunSessionRemoteConfig,
  formatRemoteSessionInstructions,
  formatSimulatorUnavailableMessage,
  getLocalEgressConfig,
  getPreviewApiAccess,
  getRemoteSessionEnvironmentVariables,
  sanitizeRemoteConfigForJson,
} from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput, printJsonOnlyOutputAsync } from '../../utils/json';
import { ignoreOutputErrors, writeToStdoutAsync } from '../../utils/stdout';
import { sleepAsync } from '../../utils/promise';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';

// Allow the cold-cache client download (up to 60s) and a further minute to connect.
const EGRESS_SETUP_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000; // 5 seconds
const STARTUP_TIMEOUT_MS = 15 * 60 * 1_000; // 15 minutes, excluding time in the queue
const OUT_CONFIG_TYPE_VALUES = {
  Env: 'env',
  Dotenv: 'dotenv',
} as const;
const EGRESS_FLAG_VALUES = ['local'] as const;

export default class Simulator extends EasCommand {
  static override aliases = ['simulator:start', ...getSimulatorCommandAliases('start')];
  static override hiddenAliases = [
    ...SIMULATOR_TOPIC_ALIASES,
    ...SIMULATOR_HIDDEN_TOPIC_ALIASES,
    ...getSimulatorCommandHiddenAliases('start'),
  ];
  static override description = `start a remote simulator session on EAS

Preview links require sign-in by default.

Use --import to load saved start options and actions. CLI flags override saved options, including lists:

{
  "version": 1,
  "start": {"device": "iPhone 17 Pro", "type": "web-preview-only"},
  "actions": [{"action": "appearance.set", "params": {"value": "dark"}}]
}

The start object uses CLI flag names. Saved actions run after the session is ready. Local action paths are relative to the JSON file. If an action fails, the CLI tries to stop the new session. Android supports saved start options, but not actions yet.

With local egress, actions wait for the connection and require interactive mode. In scripts, connect with simulator:egress, then run simulator:control --import separately.`;

  static override examples = [
    '$ eas simulator:start --import ./simulator.json',
    '$ eas simulator:start --import ./simulator.json --platform ios --device "iPhone 17 Pro" --json',
  ];

  static override flags = {
    import: Flags.string({
      description: 'Load start options and actions from a JSON file',
    }),
    platform: Flags.option({
      char: 'p',
      description: 'Device platform',
      options: DEVICE_RUN_SESSION_PLATFORM_FLAG_VALUES,
    })(),
    name: Flags.string({
      description:
        'Human-readable name for the simulator session, shown in eas simulator:list and on expo.dev. Defaults to unnamed.',
    }),
    tag: Flags.string({
      description:
        'Label used to group simulator sessions, for example one per app variant. Repeat for multiple tags. Stored lowercased.',
      multiple: true,
    }),
    device: Flags.string({
      description:
        'Virtual device to start for the session. On iOS, a Simulator device name or UDID (e.g. "iPhone 17 Pro"). On Android, an AVD hardware profile id (e.g. "pixel_9"). Defaults to a device chosen by the runner. eas simulator:devices lists the devices Expo suggests.',
    }),
    'system-image': Flags.string({
      description:
        'Android SDK system image package to use for the emulator (e.g. "system-images;android-35-ext15;google_apis_playstore;x86_64"). Defaults to a system image chosen by the runner. Only supported with --platform android.',
    }),
    'build-id': Flags.string({
      description: 'EAS Build to install and launch before the simulator session is ready.',
      exclusive: ['build-fingerprint', 'application-archive-url', 'expo-go'],
    }),
    'build-fingerprint': Flags.string({
      description:
        'Fingerprint hash of an EAS Build to install and launch before the simulator session is ready. Uses the most recent finished build with this fingerprint that can be installed on the simulator.',
      exclusive: ['build-id', 'application-archive-url', 'expo-go'],
    }),
    'application-archive-url': Flags.string({
      description:
        'Application archive URL to download, install, and launch before the simulator session is ready.',
      exclusive: ['build-id', 'build-fingerprint', 'expo-go'],
    }),
    'expo-go': Flags.boolean({
      description:
        "Install and launch Expo Go matching the current project's Expo SDK before the simulator session is ready.",
      exclusive: ['build-id', 'build-fingerprint', 'application-archive-url'],
    }),
    'sdk-version': Flags.string({
      description:
        'Expo SDK version used to select Expo Go when --expo-go is passed. Defaults to the current project SDK.',
    }),
    'launch-arg': Flags.string({
      description:
        'Argument passed to the installed application when it launches. Repeat for multiple arguments.',
      multiple: true,
    }),
    'open-url': Flags.string({
      description:
        'Expo or development-client URL to open in the installed application after it launches.',
    }),
    type: Flags.option({
      description:
        'Type of simulator session to create. All session types include a web preview. agent-device, appium, and argent also include an automation interface; web-preview-only includes no automation interface.',
      options: DEVICE_RUN_SESSION_TYPE_FLAG_OPTIONS,
      default: DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.AgentDevice],
    })(),
    'package-version': Flags.string({
      description:
        'Version of the package backing the simulator session (e.g. "0.1.3-alpha.3"). Defaults to "latest" when omitted.',
    }),
    'log-source': Flags.option({
      description:
        'Android logs to record during the session and upload afterward. Repeat to select both sources; replaces the default emulator-output selection. Device-wide device-logcat may contain credentials and personal data. Logs are not redacted.',
      options: ['emulator-output', 'device-logcat'],
      multiple: true,
    })(),
    'network-capture': Flags.boolean({
      allowNo: true,
      description:
        'Record HTTP(S) traffic from apps on the device (iOS only). HTTPS is decrypted, so recordings contain credentials in cleartext and certificate-pinned apps fail to connect.',
    }),
    'network-capture-field': Flags.string({
      description:
        'What a recording may keep beyond method, URL, status, timing and size: header, query, request-body, response-body. Repeatable or comma-separated. Defaults to none of them, because each can carry credentials.',
      multiple: true,
      dependsOn: ['network-capture'],
    }),
    'max-duration-minutes': Flags.integer({
      description:
        "Maximum duration of the simulator session in minutes before it is automatically stopped. Defaults to, and cannot exceed, the maximum session duration of the account's plan.",
      min: 0,
    }),
    'max-idle-time-minutes': Flags.integer({
      description:
        'Stop the simulator session automatically after this many minutes without session activity. When omitted, the session has no idle timeout and runs until its maximum duration.',
      min: 0,
    }),
    'resource-class': Flags.option({
      description: 'The instance type that will be used to run this simulator session',
      hidden: true,
      options: Object.values(DEVICE_RUN_SESSION_RESOURCE_CLASS_FLAG_VALUES),
    })(),
    egress: Flags.option({
      description:
        '[EXPERIMENTAL] With "local", the simulator\'s network traffic exits from this machine and fails while the egress client is disconnected. On iOS, the simulator system proxy points at this machine: HTTP(S) and WebSocket requests that honor it (WebKit, URLSession) and clients that read proxy environment variables (gRPC, libcurl) use it, and connections that ignore both are refused inside the simulator and listed, with the library that tried, in the Logs section of the session page on expo.dev. On Android, all TCP traffic from the emulator goes through its proxy to this machine; traffic that cannot (UDP, such as QUIC) is refused and listed in the same Logs section, and DNS for apps that ignore the system proxy resolves on the device host. The egress client must keep running for the life of the session.',
      options: EGRESS_FLAG_VALUES,
    })(),
    'egress-allow': Flags.string({
      description:
        'Destination on this machine or its network that the simulator may reach through local egress, as an exact host:port (for example localhost:3000). Repeat for multiple destinations. A localhost or 127.0.0.1 entry also forwards that port from the simulator host to this machine (like adb reverse), so dev server URLs that use 127.0.0.1 work. On Android, such an entry also covers 10.0.2.2 on the same port. Requires --egress local.',
      multiple: true,
      dependsOn: ['egress'],
    }),
    'cors-origin': Flags.string({
      description:
        'Origin of a page that may call the simulator preview API cross-origin, for example to render the device with @expo/hub-client, such as https://app.example.com or https://*.example.com. Repeat for multiple origins. Embedding the preview in a frame does not need this; use --frame-ancestor for that. The page still needs the printed preview URL and its token.',
      multiple: true,
    }),
    'frame-ancestor': Flags.string({
      description:
        'Origin of a page that may embed the simulator preview in a frame, such as https://app.example.com or https://*.example.com. Repeat for multiple origins. The embedding page loads the printed preview URL, which carries the session token, so anyone who can read that page can also control the simulator.',
      multiple: true,
    }),
    force: Flags.boolean({
      description:
        '[default: true] Create a new simulator session even when an existing simulator session is present in the environment.',
      default: true,
      allowNo: true,
    }),
    'out-config-type': Flags.option({
      description: `How to output simulator connection configuration. Use "env" to print shell exports, or "dotenv" to write ${SIMULATOR_DOTENV_FILE_NAME}.`,
      options: Object.values(OUT_CONFIG_TYPE_VALUES),
      default: OUT_CONFIG_TYPE_VALUES.Dotenv,
    })(),
    'public-link': Flags.boolean({
      allowNo: true,
      description:
        'Enable the simulator preview Share button and print a shareable link containing an access token. Anyone with the link can control the simulator. With --json, include previewApiUrl and its token for API clients when available.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
  };

  async runAsync(): Promise<void> {
    // Import preflight can fail before parsing; keep diagnostics off JSON stdout.
    if (this.argv.includes('--json')) {
      enableJsonOutput();
    }
    const imported = await resolveStartConfigAsync(this.argv, Simulator.flags);
    const { flags } = await this.parse(Simulator, imported.argv);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const {
      projectId,
      projectDir,
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(Simulator, {
      nonInteractive,
    });

    // The server would reject the session anyway, but check the gate first so gated
    // accounts get the upgrade link instead of a generic permission error. Expo admins
    // skip the check so they can work on any account and let the server decide.
    if (!actor.isExpoAdmin) {
      const { accountName, available } = await DeviceRunSessionAvailabilityQuery.byAppIdAsync(
        graphqlClient,
        projectId
      );
      if (!available) {
        throw new EasCommandError(formatSimulatorUnavailableMessage(accountName));
      }
    }

    // The server rejects blank names, so trim here and treat a whitespace-only
    // --name as if it had been omitted rather than surfacing a validation error.
    const name = flags.name?.trim() || undefined;
    const tags = flags.tag?.map(tag => tag.trim()).filter(tag => tag.length > 0);
    const deviceIdentifier = flags.device?.trim() || undefined;
    const systemImagePackage = flags['system-image']?.trim() || undefined;
    const logSources = flags['log-source'];
    const buildId = flags['build-id']?.trim() || undefined;
    const buildFingerprint = flags['build-fingerprint']?.trim() || undefined;
    const applicationArchiveUrlFromFlag = flags['application-archive-url']?.trim() || undefined;
    const sdkVersionFromFlag = flags['sdk-version']?.trim() || undefined;
    const launchArgs = flags['launch-arg'];
    const openUrl = flags['open-url']?.trim() || undefined;
    const resourceClass = flags['resource-class']
      ? DEVICE_RUN_SESSION_RESOURCE_CLASS_BY_FLAG_VALUE[flags['resource-class']]
      : undefined;

    if (sdkVersionFromFlag && !flags['expo-go']) {
      throw new EasCommandError('The --sdk-version flag can only be used with --expo-go.');
    }
    if (
      (launchArgs?.length || openUrl) &&
      !buildId &&
      !buildFingerprint &&
      !applicationArchiveUrlFromFlag &&
      !flags['expo-go']
    ) {
      throw new EasCommandError(
        'Launch options require an application source. Pass --build-id, --build-fingerprint, --application-archive-url, or --expo-go.'
      );
    }

    await loadSimulatorEnvAsync(projectDir);
    const existingDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];
    if (existingDeviceRunSessionId && !flags.force) {
      throw new Error(
        `Existing simulator session in environment. Use --force to create a new simulator session.`
      );
    }

    // Before the platform prompt: a typo here does not depend on the answer.
    let networkCaptureFields: string[] = [];
    try {
      networkCaptureFields = parseNetworkCaptureFields(flags['network-capture-field'] ?? []);
    } catch (err) {
      throw new EasCommandError(err instanceof Error ? err.message : String(err));
    }
    if (networkCaptureFields.length && !flags['network-capture']) {
      throw new EasCommandError('--network-capture-field requires --network-capture.');
    }

    const platform = await resolvePlatformAsync(flags.platform, nonInteractive);
    const egress = flags.egress === 'local' ? DeviceRunSessionEgress.Local : undefined;
    if (logSources && platform !== AppPlatform.Android) {
      throw new EasCommandError(
        '--log-source selects Android emulator logs. Pass --platform android.'
      );
    }
    if (systemImagePackage && platform !== AppPlatform.Android) {
      throw new EasCommandError('--system-image is only supported with --platform android.');
    }
    let egressAllow: string[] = [];
    try {
      egressAllow = parseEgressAllowList(flags['egress-allow'] ?? []);
    } catch (err) {
      throw new EasCommandError(err instanceof Error ? err.message : String(err));
    }
    let frameAncestors: string[] = [];
    try {
      frameAncestors = parseFrameAncestorList(flags['frame-ancestor'] ?? []);
    } catch (err) {
      throw new EasCommandError(err instanceof Error ? err.message : String(err));
    }
    let corsOrigins: string[] = [];
    try {
      corsOrigins = parseCorsOriginList(flags['cors-origin'] ?? []);
    } catch (err) {
      throw new EasCommandError(err instanceof Error ? err.message : String(err));
    }
    if (flags['network-capture'] && platform !== AppPlatform.Ios) {
      throw new EasCommandError(
        'Network capture is only supported on iOS simulator sessions. Re-run without --network-capture, or pass --platform ios.'
      );
    }

    if (platform === AppPlatform.Android && imported.config?.actions?.length) {
      throw new EasCommandError(
        'Imported control actions are not supported on Android yet. Remove actions to import only start settings, or use --platform ios.'
      );
    }

    if (nonInteractive && egress && imported.config?.actions?.length) {
      throw new EasCommandError(
        'Imported actions with local egress require interactive mode. Start without actions, connect eas simulator:egress, then run eas simulator:control --import with the same file.'
      );
    }

    const expoGoSdkVersion = flags['expo-go']
      ? await resolveExpoGoSdkVersionAsync({ projectDir, sdkVersion: sdkVersionFromFlag })
      : undefined;

    if (existingDeviceRunSessionId) {
      Log.warn(
        `  Overwriting previous simulator session (id: ${existingDeviceRunSessionId}). ` +
          `The previous remote session will continue running until stopped. ` +
          `To stop it, run: eas simulator:stop --id ${existingDeviceRunSessionId}`
      );
      Log.newLine();
    }

    // Same services as the outage banner on the simulator pages of the website.
    await maybeWarnAboutEasOutagesAsync(graphqlClient, [
      StatuspageServiceName.EasSimulator,
      StatuspageServiceName.EasWorkflows,
    ]);

    const createSpinner = ora('🚀 Creating simulator session').start();
    let deviceRunSessionId: string;
    let deviceRunSessionUrl: string;
    let deviceRunSessionPreviewUrl: string;
    let sessionInterrupt: SessionInterrupt | undefined;
    try {
      const agentIdentity = await agentIdentityInputAsync();
      const requestProperties = simulatorRequestProperties({
        projectId,
        type: flags.type,
        platform,
        hasBuildId: !!buildId || !!buildFingerprint,
        hasArchiveUrl: !!applicationArchiveUrlFromFlag,
        expoGo: !!expoGoSdkVersion,
        packageVersion: flags['package-version'],
        nonInteractive,
      });
      const android = {
        ...(deviceIdentifier ? { deviceIdentifier } : {}),
        ...(systemImagePackage ? { systemImagePackage } : {}),
        ...(logSources ? { logSources } : {}),
      };
      const platformInput =
        platform === AppPlatform.Ios
          ? deviceIdentifier
            ? { ios: { deviceIdentifier } }
            : {}
          : Object.keys(android).length
            ? { android }
            : {};
      const session = await withSimulatorRequestAnalyticsAsync(
        analytics,
        requestProperties,
        createSpinner,
        () =>
          DeviceRunSessionMutation.createDeviceRunSessionAsync(graphqlClient, {
            appId: projectId,
            name,
            ...(tags?.length ? { tags } : {}),
            platform,
            type: DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE[flags.type],
            publicPreview: flags['public-link'] ?? false,
            packageVersion: flags['package-version'],
            networkCapture: flags['network-capture'],
            ...(networkCaptureFields.length ? { networkCaptureFields } : {}),
            ...platformInput,
            ...(buildId ? { buildId } : {}),
            ...(buildFingerprint ? { buildFingerprint } : {}),
            ...(applicationArchiveUrlFromFlag
              ? { applicationArchiveUrl: applicationArchiveUrlFromFlag }
              : {}),
            ...(expoGoSdkVersion ? { expoGo: true, sdkVersion: expoGoSdkVersion } : {}),
            ...(launchArgs?.length ? { launchArgs } : {}),
            ...(openUrl ? { openUrl } : {}),
            ...(resourceClass ? { resourceClass } : {}),
            ...(egress ? { egress } : {}),
            ...(frameAncestors.length ? { frameAncestors } : {}),
            ...(corsOrigins.length ? { corsOrigins } : {}),
            requestOrigin: DeviceRunSessionRequestOrigin.EasCli,
            ...agentIdentity,
            maxRunTimeMinutes: flags['max-duration-minutes'],
            maxIdleTimeMinutes: flags['max-idle-time-minutes'],
          }),
        createdSession =>
          stopDeviceRunSessionCreatedAfterCancelAsync(graphqlClient, createdSession.id)
      );
      deviceRunSessionId = session.id;
      // Register as soon as the session exists, so an error or signal from here on stops it.
      sessionInterrupt = registerSessionInterrupt(graphqlClient, deviceRunSessionId);
      nullthrows(session.turtleJobRun?.id, 'Expected simulator session to start');
      deviceRunSessionUrl = getDeviceRunSessionUrl(
        session.app.ownerAccount.name,
        session.app.slug,
        deviceRunSessionId
      );
      deviceRunSessionPreviewUrl = getDeviceRunSessionPreviewUrl(
        session.app.ownerAccount.name,
        session.app.slug,
        deviceRunSessionId
      );
      const simulatorEnvWritten =
        !jsonFlag &&
        !imported.config?.actions?.length &&
        flags['out-config-type'] === OUT_CONFIG_TYPE_VALUES.Dotenv
          ? await writeSimulatorEnvSafelyAsync(projectDir, {
              [EAS_SIMULATOR_SESSION_ID]: deviceRunSessionId,
            })
          : false;
      createSpinner.succeed(
        `Simulator session created (id: ${deviceRunSessionId}${
          simulatorEnvWritten ? `, saved to ${SIMULATOR_DOTENV_FILE_NAME}` : ''
        }) ${link(deviceRunSessionUrl)}`
      );
      if (flags['network-capture']) {
        Log.warn(
          'Network capture was requested. HTTPS is decrypted, so recordings contain credentials in cleartext. Relaunch an installed app to record its traffic.'
        );
      }
    } catch (err) {
      createSpinner.fail('Failed to create simulator session');
      if (sessionInterrupt) {
        // The session exists on EAS, but the user never received it.
        await stopDeviceRunSessionAfterStartupErrorAsync({
          sessionInterrupt,
          projectDir,
          jsonFlag,
        });
        sessionInterrupt.exitIfSignalReceived();
        sessionInterrupt.dispose();
      }
      throw err;
    }

    const pollSpinner = ora(`⏳ Waiting for ${flags.type} session to be ready`);
    let startupDeadline: number | undefined = Date.now() + STARTUP_TIMEOUT_MS;
    let remoteConfig: DeviceRunSessionRemoteConfig | undefined;

    try {
      pollSpinner.start();
      while (!sessionInterrupt.signal.aborted) {
        const session = await Promise.race([
          DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId, {
            signal: sessionInterrupt.signal,
          }),
          sessionInterrupt.abortPromise,
        ]);

        if (!session) {
          break;
        }

        if (
          session.status === DeviceRunSessionStatus.Errored ||
          session.status === DeviceRunSessionStatus.Stopped
        ) {
          throw new Error(
            `Simulator session ${deviceRunSessionId} ${session.status.toLowerCase()} before the ${flags.type} session was ready. ${link(deviceRunSessionUrl)}${await formatJobRunErrorsAsync(graphqlClient, deviceRunSessionId, sessionInterrupt.signal)}`
          );
        }

        const jobRunStatus = session.turtleJobRun?.status;
        if (
          jobRunStatus === JobRunStatus.Errored ||
          jobRunStatus === JobRunStatus.Canceled ||
          jobRunStatus === JobRunStatus.Finished
        ) {
          throw new Error(
            `Turtle job run for simulator session ${deviceRunSessionId} ${jobRunStatus.toLowerCase()} before the ${flags.type} session was ready. ${link(deviceRunSessionUrl)}${await formatJobRunErrorsAsync(graphqlClient, deviceRunSessionId, sessionInterrupt.signal)}`
          );
        }

        if (session.remoteConfig) {
          remoteConfig = session.remoteConfig;
          pollSpinner.succeed(`🎉 ${flags.type} session is ready`);
          break;
        }

        if (jobRunStatus === JobRunStatus.New || jobRunStatus === JobRunStatus.InQueue) {
          startupDeadline = undefined;
          pollSpinner.text = '⏳ Simulator session queued or waiting for available concurrency';
        } else {
          startupDeadline ??= Date.now() + STARTUP_TIMEOUT_MS;
          pollSpinner.text = `⏳ Waiting for ${flags.type} session to start`;
          if (Date.now() >= startupDeadline) {
            break;
          }
        }

        await sleepAsync(POLL_INTERVAL_MS, sessionInterrupt.signal);
      }
    } catch (err) {
      pollSpinner.fail(`Failed while polling for ${flags.type} session to be ready`);
      // Also clears the session ID saved in .env.eas-simulator, so it does not point to a stopped
      // session.
      await stopDeviceRunSessionAfterStartupErrorAsync({ sessionInterrupt, projectDir, jsonFlag });
      sessionInterrupt.exitIfSignalReceived();
      sessionInterrupt.dispose();
      throw err;
    }

    if (sessionInterrupt.signal.aborted) {
      await stopDeviceRunSessionAfterInterruptAsync({
        projectDir,
        spinner: pollSpinner,
        sessionInterrupt,
      });
      return;
    }

    if (!remoteConfig) {
      pollSpinner.fail(`Timed out waiting for ${flags.type} session to start`);
      await stopDeviceRunSessionAfterStartupErrorAsync({ sessionInterrupt, projectDir, jsonFlag });
      sessionInterrupt.exitIfSignalReceived();
      sessionInterrupt.dispose();
      throw new Error(
        `Timed out after ${Math.round(STARTUP_TIMEOUT_MS / 1000)}s waiting for ${flags.type} session to start (excluding time in the queue). ${link(deviceRunSessionUrl)}`
      );
    }

    const localEgress = getLocalEgressConfig(remoteConfig, egressAllow, platform);
    let egressPromise: Promise<void> | undefined;
    let egressError: Error | undefined;
    const egressAbortController = new AbortController();
    let markEgressReady: () => void;
    const egressReady = new Promise<void>(resolve => {
      markEgressReady = resolve;
    });
    const onSessionAbort = (): void => {
      egressAbortController.abort();
    };
    const startLocalEgress = (): void => {
      if (localEgress && !nonInteractive) {
        sessionInterrupt.signal.addEventListener('abort', onSessionAbort, { once: true });
        egressPromise = runLocalEgressAsync({
          ...localEgress,
          signal: egressAbortController.signal,
          onConnected: () => {
            markEgressReady();
            Log.succeed('Egress tunnel connected.');
          },
          onDisconnected: () => {
            Log.warn(
              'Egress tunnel disconnected; reconnecting. Proxied HTTP(S) requests are unavailable until it reconnects.'
            );
          },
        }).catch(err => {
          egressError = err instanceof Error ? err : new Error(String(err));
          Log.error(
            `${err instanceof Error ? err.message : String(err)} Stopping the simulator session.`
          );
          sessionInterrupt.abort();
        });
      }
    };
    const writeReadySimulatorEnvAsync = async (): Promise<void> => {
      if (flags['out-config-type'] === OUT_CONFIG_TYPE_VALUES.Dotenv) {
        await writeSimulatorEnvSafelyAsync(projectDir, {
          ...getRemoteSessionEnvironmentVariables(remoteConfig, { egressAllow, platform }),
          [EAS_SIMULATOR_SESSION_ID]: deviceRunSessionId,
        });
      }
    };
    const stopAfterInterruptAsync = async (spinner: Ora): Promise<void> => {
      await stopDeviceRunSessionAfterInterruptAsync({ projectDir, spinner, sessionInterrupt });
    };
    try {
      if (!jsonFlag && !imported.config?.actions?.length) {
        await writeReadySimulatorEnvAsync();
      }

      if (sessionInterrupt.signal.aborted && !egressError) {
        await stopAfterInterruptAsync(pollSpinner);
        return;
      }

      if (!jsonFlag) {
        Log.newLine();
        const instructions = formatRemoteSessionInstructions(
          remoteConfig,
          flags['out-config-type'],
          {
            egressAllow,
            egressClientRunsInline: !nonInteractive,
            sessionUrl: deviceRunSessionUrl,
            privatePreviewUrl: deviceRunSessionPreviewUrl,
            publicLink: flags['public-link'],
            frameAncestors,
            corsOrigins,
            platform,
          }
        );
        if (nonInteractive && flags['out-config-type'] === OUT_CONFIG_TYPE_VALUES.Env) {
          // stdout is the only handoff in this mode: the caller gets the session only from the
          // printed exports. Write them with a checked write and hand the session off when stdout
          // accepted them, for example not when the reading end of a pipe closed. Later output,
          // which the caller may not read, does not count.
          await Promise.race([
            writeToStdoutAsync(`${instructions}\n`),
            sessionInterrupt.abortPromise,
          ]);
          if (sessionInterrupt.signal.aborted) {
            await stopAfterInterruptAsync(pollSpinner);
            return;
          }
        } else {
          Log.log(instructions);
        }
        Log.newLine();
        if (nonInteractive) {
          Log.log(
            `When you are done, stop the session with: eas simulator:stop --id ${deviceRunSessionId}`
          );
        }
      }

      let setup:
        | { config: string; results: ReturnType<typeof serializeControlConfigResults> }
        | undefined;
      if (imported.config?.actions?.length) {
        const total = imported.config.actions.length;
        if (!jsonFlag) {
          Log.newLine();
          Log.log(
            `Importing ${total} action${total === 1 ? '' : 's'} from ${imported.config.path}`
          );
        }
        startLocalEgress();
        const setupSpinner = ora('Importing simulator configuration').start();
        try {
          if (egress && !localEgress) {
            throw new Error('The ready session did not provide local egress connection settings.');
          }
          if (egressPromise) {
            setupSpinner.text = 'Waiting for local egress before applying configuration';
            let timer: NodeJS.Timeout | undefined;
            try {
              await Promise.race([
                egressReady,
                egressPromise,
                sessionInterrupt.abortPromise,
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => {
                    reject(new Error('Local egress did not connect within 120 seconds.'));
                  }, EGRESS_SETUP_TIMEOUT_MS);
                  timer.unref();
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
            if (egressError) {
              throw egressError;
            }
            sessionInterrupt.signal.throwIfAborted();
          }
          const access = getPreviewApiAccess(remoteConfig);
          if (!access) {
            throw new Error(
              'This session does not expose an authenticated preview API for control actions.'
            );
          }
          // Race the abort: packaging a large app can take long, and the stop must start at once.
          // Exiting removes the unfinished archive.
          const results = await Promise.race([
            applyStartConfigAsync(access, imported.config, {
              signal: sessionInterrupt.signal,
              onProgress: jsonFlag
                ? undefined
                : progress => {
                    const label = `[${progress.step}/${progress.total}] ${progress.action}`;
                    if (progress.status === 'running') {
                      setupSpinner.start(label);
                    } else {
                      setupSpinner.succeed(`${label} completed`);
                      if (progress.result.file) {
                        Log.log(`Saved ${progress.result.file}`);
                      } else if (progress.result.output) {
                        Log.log(progress.result.output);
                      }
                    }
                  },
            }),
            sessionInterrupt.abortPromise.then(() => undefined),
          ]);
          sessionInterrupt.signal.throwIfAborted();
          setup = {
            config: imported.config.path,
            results: serializeControlConfigResults(nullthrows(results)),
          };
          setupSpinner.succeed(
            `Import complete: ${total} action${total === 1 ? '' : 's'} completed`
          );
        } catch (caught) {
          egressAbortController.abort();
          await egressPromise;
          const error = egressError ?? caught;
          if (sessionInterrupt.signal.aborted && !egressError) {
            await stopAfterInterruptAsync(setupSpinner);
            return;
          }
          if (error instanceof ControlConfigExecutionError) {
            setupSpinner.fail(`[${error.step}/${total}] ${error.action} failed`);
            if (!jsonFlag) {
              const skipped = total - error.step;
              Log.log(`${error.completed.length} completed · 1 failed · ${skipped} skipped`);
              for (const [index, action] of imported.config.actions.entries()) {
                if (index >= error.step) {
                  Log.log(`  [${index + 1}/${total}] ${action.action} skipped`);
                }
              }
            }
          } else {
            setupSpinner.fail('Simulator configuration import failed');
          }
          sessionInterrupt.markCleanupHandled();
          const stopped = await sessionInterrupt.stopSessionAsync();
          if (stopped) {
            if (!jsonFlag) {
              Log.succeed('Stopped the simulator session after setup failed.');
            }
            await resetSimulatorEnvAsync(projectDir, deviceRunSessionId).catch(error => {
              Log.warn(
                `The session stopped, but ${SIMULATOR_DOTENV_FILE_NAME} could not be cleaned up: ${error instanceof Error ? error.message : String(error)}`
              );
            });
          } else {
            Log.warnToStderr(
              `Could not confirm cleanup. Run eas simulator:stop --id ${deviceRunSessionId} to stop the session.`
            );
          }
          sessionInterrupt.exitIfSignalReceived();
          sessionInterrupt.dispose();
          if (jsonFlag) {
            printJsonOnlyOutput({
              id: deviceRunSessionId,
              deviceRunSessionUrl,
              stopped,
              setup: {
                config: imported.config.path,
                results:
                  error instanceof ControlConfigExecutionError
                    ? serializeControlConfigResults(error.completed)
                    : [],
                error: {
                  ...(error instanceof ControlConfigExecutionError
                    ? { step: error.step, action: error.action }
                    : {}),
                  message: error instanceof Error ? error.message : String(error),
                },
              },
            });
            process.exitCode = 1;
            return;
          }
          throw error;
        }
      }

      if (jsonFlag || imported.config?.actions?.length) {
        // Keep the previous session's saved credentials until setup succeeds.
        await writeReadySimulatorEnvAsync();
        if (egressError) {
          // Local egress failed and aborted the session. The catch below stops the session.
          throw egressError;
        }
        if (sessionInterrupt.signal.aborted) {
          // Let local egress shut down before the stop exits the process.
          await egressPromise;
          await stopAfterInterruptAsync(pollSpinner);
          return;
        }
      }
      if (jsonFlag) {
        // The session is handed off only when stdout accepted the JSON. Until then, an error or a
        // signal still stops it.
        const jsonWritten = printJsonOnlyOutputAsync({
          id: deviceRunSessionId,
          name,
          type: flags.type,
          deviceRunSessionUrl,
          ...(setup ? { setup } : {}),
          remoteConfig: sanitizeRemoteConfigForJson(
            remoteConfig,
            deviceRunSessionPreviewUrl,
            flags['public-link'],
            { frameAncestors, corsOrigins }
          ),
        });
        await Promise.race([jsonWritten, sessionInterrupt.abortPromise]);
        if (sessionInterrupt.signal.aborted) {
          await stopAfterInterruptAsync(pollSpinner);
        }
        return;
      }

      if (nonInteractive) {
        return;
      }

      if (!imported.config?.actions?.length) {
        startLocalEgress();
      }

      await waitForSessionEndOrInterruptAsync({
        graphqlClient,
        deviceRunSessionId,
        deviceRunSessionUrl,
        projectDir,
        sessionInterrupt,
      });
      if (egressError) {
        throw egressError;
      }
    } catch (error) {
      // Paths that stop the session themselves, or that saw it end, have already started the stop.
      // Any other error means the user never received the session, so stop it here.
      if (!sessionInterrupt.cleanupHandled) {
        await stopDeviceRunSessionAfterStartupErrorAsync({
          sessionInterrupt,
          projectDir,
          jsonFlag,
        });
      } else {
        // A stop started by a signal may still be running.
        await sessionInterrupt.stopSessionAsync();
      }
      if (sessionInterrupt.signal.aborted) {
        // Let local egress shut down before a signal exit skips the `finally` below.
        egressAbortController.abort();
        await egressPromise;
      }
      sessionInterrupt.exitIfSignalReceived();
      throw error;
    } finally {
      sessionInterrupt.signal.removeEventListener('abort', onSessionAbort);
      // Paths that already disposed it are unaffected. An unexpected error, for example while
      // printing the session instructions, must not leave the signal listeners installed.
      sessionInterrupt.dispose();
      egressAbortController.abort();
      await egressPromise;
    }
  }
}

// Returns the reasons the session's job run failed, one per line, or an empty string when none are available.
async function formatJobRunErrorsAsync(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string,
  signal: AbortSignal
): Promise<string> {
  const errors = await fetchSimulatorSessionErrorsAsync(graphqlClient, deviceRunSessionId, {
    signal,
  });
  return errors.map(error => `\n${formatSimulatorSessionError(error)}`).join('');
}

async function resolvePlatformAsync(
  platform: DeviceRunSessionPlatformFlagValue | undefined,
  nonInteractive: boolean
): Promise<AppPlatform> {
  if (platform) {
    return DEVICE_RUN_SESSION_PLATFORM_BY_FLAG_VALUE[platform];
  }

  if (nonInteractive) {
    throw new Error('The --platform flag must be set when running in non-interactive mode.');
  }

  const { selectedPlatform } = await promptAsync({
    type: 'select',
    message: 'Select platform',
    name: 'selectedPlatform',
    choices: [
      { title: 'Android', value: AppPlatform.Android },
      { title: 'iOS', value: AppPlatform.Ios },
    ],
  });
  return selectedPlatform;
}

async function writeSimulatorEnvSafelyAsync(
  projectDir: string,
  environmentVariables: Record<string, string>
): Promise<boolean> {
  try {
    await writeSimulatorEnvAsync(projectDir, environmentVariables);
    return true;
  } catch (err) {
    Log.warn(
      `Failed to write simulator environment variables to ${SIMULATOR_DOTENV_FILE_NAME}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}

async function waitForSessionEndOrInterruptAsync({
  graphqlClient,
  deviceRunSessionId,
  deviceRunSessionUrl,
  projectDir,
  sessionInterrupt,
}: {
  graphqlClient: ExpoGraphqlClient;
  deviceRunSessionId: string;
  deviceRunSessionUrl: string;
  projectDir: string;
  sessionInterrupt: SessionInterrupt;
}): Promise<void> {
  Log.log(
    `To stop the session from another shell, run: eas simulator:stop --id ${deviceRunSessionId}`
  );
  // Keep the spinner text short so it fits on one line. When the text wraps, resizing the
  // terminal can leave copies of the spinner line behind.
  const spinner = ora('Simulator session active — press Ctrl+C to stop').start();

  const { signal } = sessionInterrupt;
  try {
    while (!signal.aborted) {
      let session;
      try {
        // Race the abort so a stalled poll cannot delay the stop after Ctrl+C or SIGTERM. A runner
        // can follow SIGTERM with SIGKILL soon after.
        session = await Promise.race([
          // No retries: this loop polls again on failure, and a retry timer would keep the process
          // running after the stop.
          DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId, {
            signal,
            noRetry: true,
          }),
          sessionInterrupt.abortPromise,
        ]);
      } catch (err) {
        Log.debug(
          `Failed to poll simulator session: ${err instanceof Error ? err.message : String(err)}`
        );
        await sleepAsync(POLL_INTERVAL_MS, signal);
        continue;
      }
      if (!session) {
        break;
      }

      const jobRunStatus = session.turtleJobRun?.status;
      if (
        session.status === DeviceRunSessionStatus.Errored ||
        jobRunStatus === JobRunStatus.Errored
      ) {
        spinner.fail(`Simulator session errored. ${link(deviceRunSessionUrl)}`);
        sessionInterrupt.markSessionEnded();
        throw new Error(
          `Simulator session ${deviceRunSessionId} errored.${await formatJobRunErrorsAsync(graphqlClient, deviceRunSessionId, signal)}`
        );
      }
      if (
        session.status === DeviceRunSessionStatus.Stopped ||
        jobRunStatus === JobRunStatus.Canceled ||
        jobRunStatus === JobRunStatus.Finished
      ) {
        spinner.succeed(`Simulator session ended. ${link(deviceRunSessionUrl)}`);
        sessionInterrupt.markSessionEnded();
        await resetSimulatorEnvVerboseAsync(projectDir, deviceRunSessionId);
        return;
      }

      await sleepAsync(POLL_INTERVAL_MS, signal);
    }

    spinner.text = 'Stopping simulator session...';
    sessionInterrupt.markCleanupHandled();
    const stopped = await sessionInterrupt.stopSessionAsync();
    if (stopped) {
      spinner.succeed('Simulator session stopped');
      await resetSimulatorEnvVerboseAsync(projectDir, deviceRunSessionId);
    } else {
      // stderr: stdout may be a closed pipe, and the user needs this command.
      spinner.stop();
      Log.warnToStderr(
        `Could not confirm the simulator session was stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
      );
    }
  } finally {
    sessionInterrupt.dispose();
  }
}

/**
 * Signals that stop the session. Ctrl+C sends SIGINT. Package runners such as `pnpm dlx` can
 * forward SIGTERM to the CLI instead, and without a handler Node exits at once and leaves the
 * session running on EAS.
 */
const INTERRUPT_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
type InterruptSignal = (typeof INTERRUPT_SIGNALS)[number];

/**
 * How long after the first signal another signal still counts as the same cancellation. Runners such
 * as `pnpm dlx` forward the signal to the CLI, and the terminal also sends it to the CLI's process
 * group, so one Ctrl+C can arrive twice within milliseconds. Only a later signal forces an exit.
 */
const REPEATED_SIGNAL_WINDOW_MS = 1_000;

/** Shell convention: 128 + the signal number. */
const EXIT_CODE_BY_INTERRUPT_SIGNAL: Record<InterruptSignal, number> = {
  SIGINT: 130,
  SIGTERM: 143,
};

/** Listens for every interrupt signal and returns a function that removes the listeners. */
function addInterruptListener(listener: (signal: InterruptSignal) => void): () => void {
  const listeners = INTERRUPT_SIGNALS.map(signal => {
    const onSignal = (): void => {
      listener(signal);
    };
    process.on(signal, onSignal);
    return { signal, onSignal };
  });
  return () => {
    for (const { signal, onSignal } of listeners) {
      process.removeListener(signal, onSignal);
    }
  };
}

type SessionInterrupt = {
  deviceRunSessionId: string;
  signal: AbortSignal;
  abortPromise: Promise<void>;
  /** Stop the session as if the user had pressed Ctrl+C. */
  abort: () => void;
  /** The exit code for the signal that interrupted the session. */
  readonly exitCode: number;
  /**
   * Stops the session on EAS. All callers share one request, so every path can call it without
   * stopping the session twice. Resolves to whether the stop was confirmed.
   */
  stopSessionAsync: () => Promise<boolean>;
  /**
   * Whether a path has taken over the full cleanup (the stop, the dotenv cleanup and the messages),
   * or the session already ended. A stop that a signal started early does not count: it does not
   * clean up the dotenv file or warn when the stop fails.
   */
  readonly cleanupHandled: boolean;
  /** Records that the calling path does the full cleanup. */
  markCleanupHandled: () => void;
  /** Records that the session ended on EAS, so no path needs to stop it. */
  markSessionEnded: () => void;
  /**
   * Exits with the signal's exit code if a signal arrived. Error paths call it after their cleanup,
   * so an interrupt during that cleanup still exits like an interrupt.
   */
  exitIfSignalReceived: () => void;
  dispose: () => void;
};

function registerSessionInterrupt(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string
): SessionInterrupt {
  const abortController = new AbortController();
  const { signal } = abortController;
  const abortPromise = new Promise<void>(resolve => {
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true }
    );
  });
  let exitCode = EXIT_CODE_BY_INTERRUPT_SIGNAL.SIGINT;
  // Tracked apart from `signal.aborted`: a local egress failure also aborts the session, and the
  // first real signal after that must not force an exit while the stop is running.
  let signalReceived = false;
  let firstSignalAt = 0;
  let cleanupHandled = false;
  let stopPromise: Promise<boolean> | undefined;
  const stopSessionAsync = async (): Promise<boolean> =>
    // Store the promise before the request starts, so a signal during the call cannot start a
    // second stop.
    await (stopPromise ??= Promise.resolve().then(() =>
      ensureDeviceRunSessionStoppedSafelyAsync(graphqlClient, deviceRunSessionId)
    ));
  const interruptHandler = (interruptSignal: InterruptSignal): void => {
    if (signalReceived) {
      if (Date.now() - firstSignalAt < REPEATED_SIGNAL_WINDOW_MS) {
        // The same cancellation, delivered again by a runner.
        return;
      }
      // Force exit on a second signal in case cleanup is hanging. The session may still be
      // running on EAS, so tell the user how to make sure it gets terminated.
      Log.errorToStderr(
        `Aborted before the simulator session could be stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
      );
      process.exit(exitCode);
    }
    signalReceived = true;
    firstSignalAt = Date.now();
    exitCode = EXIT_CODE_BY_INTERRUPT_SIGNAL[interruptSignal];
    abortController.abort();
    // Start the stop now. Local cleanup, such as closing the egress tunnel, can take seconds, and a
    // runner can follow SIGTERM with SIGKILL. Every path awaits this same request.
    void stopSessionAsync();
  };
  const removeInterruptListener = addInterruptListener(interruptHandler);
  // While the session exists, a closed stdout or stderr pipe must not crash the process before the
  // stop.
  const removeOutputErrorGuard = ignoreOutputErrors();

  return {
    deviceRunSessionId,
    signal,
    abortPromise,
    abort: () => {
      abortController.abort();
    },
    get exitCode() {
      return exitCode;
    },
    stopSessionAsync,
    get cleanupHandled() {
      return cleanupHandled;
    },
    markCleanupHandled: () => {
      cleanupHandled = true;
    },
    markSessionEnded: () => {
      cleanupHandled = true;
      stopPromise ??= Promise.resolve(true);
    },
    exitIfSignalReceived: () => {
      if (signalReceived) {
        removeInterruptListener();
        removeOutputErrorGuard();
        process.exit(exitCode);
      }
    },
    dispose: () => {
      removeInterruptListener();
      removeOutputErrorGuard();
    },
  };
}

async function stopDeviceRunSessionAfterInterruptAsync({
  projectDir,
  spinner,
  sessionInterrupt,
}: {
  projectDir: string;
  spinner: ReturnType<typeof ora>;
  sessionInterrupt: SessionInterrupt;
}): Promise<void> {
  const { deviceRunSessionId } = sessionInterrupt;
  sessionInterrupt.markCleanupHandled();
  try {
    spinner.text = 'Stopping simulator session...';
    const stopped = await sessionInterrupt.stopSessionAsync();
    if (stopped) {
      spinner.succeed('Simulator session stopped');
      // Warn instead of throwing, so the command still exits with the signal's exit code.
      await resetSimulatorEnvAsync(projectDir, deviceRunSessionId).catch(error => {
        Log.warn(
          `The session stopped, but ${SIMULATOR_DOTENV_FILE_NAME} could not be cleaned up: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    } else {
      // stderr: stdout may be a closed pipe, and the user needs this command.
      spinner.stop();
      Log.warnToStderr(
        `Could not confirm the simulator session was stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
      );
    }
  } finally {
    sessionInterrupt.dispose();
  }
  process.exit(sessionInterrupt.exitCode);
}

/**
 * Stops a ready session after an unexpected error, for example while printing its details, so the
 * session does not keep running on EAS when the user never received it.
 */
async function stopDeviceRunSessionAfterStartupErrorAsync({
  sessionInterrupt,
  projectDir,
  jsonFlag,
}: {
  sessionInterrupt: SessionInterrupt;
  projectDir: string;
  jsonFlag: boolean;
}): Promise<void> {
  const { deviceRunSessionId } = sessionInterrupt;
  sessionInterrupt.markCleanupHandled();
  const stopped = await sessionInterrupt.stopSessionAsync();
  if (!stopped) {
    // stderr: the error may be that stdout is a closed pipe, and the user needs this command.
    Log.warnToStderr(
      `Could not confirm the simulator session was stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
    );
    return;
  }
  // Clean up before printing, so a failing output stream cannot skip the cleanup.
  await resetSimulatorEnvAsync(projectDir, deviceRunSessionId).catch(error => {
    Log.warn(
      `The session stopped, but ${SIMULATOR_DOTENV_FILE_NAME} could not be cleaned up: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  if (!jsonFlag) {
    Log.log(`Stopped simulator session ${deviceRunSessionId} after the error below.`);
  }
}

async function stopDeviceRunSessionCreatedAfterCancelAsync(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string
): Promise<void> {
  const spinner = ora(
    `Stopping simulator session ${deviceRunSessionId}, which the request created after Ctrl+C`
  ).start();
  const stopped = await ensureDeviceRunSessionStoppedSafelyAsync(graphqlClient, deviceRunSessionId);
  if (stopped) {
    spinner.succeed(`Simulator session ${deviceRunSessionId} stopped`);
  } else {
    // stderr: stdout may be a closed pipe, and the user needs this command.
    spinner.stop();
    Log.warnToStderr(
      `Could not confirm the simulator session was stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
    );
  }
}

async function resetSimulatorEnvVerboseAsync(
  projectDir: string,
  deviceRunSessionId: string
): Promise<void> {
  try {
    await resetSimulatorEnvAsync(projectDir, deviceRunSessionId);
  } catch (err) {
    Log.error(`Failed to clean up ${SIMULATOR_DOTENV_FILE_NAME}`);
    throw err;
  }
}

async function ensureDeviceRunSessionStoppedSafelyAsync(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string
): Promise<boolean> {
  try {
    await DeviceRunSessionMutation.ensureDeviceRunSessionStoppedAsync(
      graphqlClient,
      deviceRunSessionId
    );
    return true;
  } catch (err) {
    // Cleanup is best-effort; surface the failure but don't mask the original error.
    Log.warn(
      `Failed to stop simulator session ${deviceRunSessionId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}

/**
 * How long Ctrl+C waits for analytics to flush. The analytics client has no request timeout, so
 * without a limit a hung network would make Ctrl+C look ignored.
 */
const CANCEL_FLUSH_TIMEOUT_MS = 1_000;

/**
 * How long Ctrl+C then waits for the create request. The server can still create the session after
 * the client stops waiting, and nothing else stops that session before its maximum duration.
 */
const CANCEL_CREATE_WAIT_MS = 5_000;

const SESSION_MAY_BE_RUNNING_WARNING =
  'A simulator session may still be running. Run `eas simulator:list` to check for a running session, and `eas simulator:stop --id <id>` to stop it.';

class SimulatorRequestCancelledError extends Error {}

/**
 * Runs the create request and logs the client-side funnel events around it: "request sent" before
 * it leaves, "request cancelled" on Ctrl+C before an answer, and "request failed" when no answer
 * arrives. "Request cancelled" means the client stopped waiting; the server can still create the
 * session. So Ctrl+C stops the spinner, flushes analytics, and waits a bounded time for the
 * request: a session that comes back goes to `stopCreatedAsync`, and otherwise the user is told how
 * to check for one. Then it exits with 130 (143 for SIGTERM), like the session's own Ctrl+C
 * handler: going through the command's error handling would print the exit as an error and report it
 * to Sentry. A second Ctrl+C or SIGTERM exits at once, unless it arrives within
 * `REPEATED_SIGNAL_WINDOW_MS` of the first: then it is the same cancellation, forwarded by a runner.
 */
async function withSimulatorRequestAnalyticsAsync<T>(
  analytics: AnalyticsWithOrchestration,
  properties: AnalyticsEventProperties,
  spinner: Ora,
  createAsync: () => Promise<T>,
  stopCreatedAsync: (created: T) => Promise<void>
): Promise<T> {
  let cancelRequested = false;
  let firstSignalAt = 0;
  let exitCode = EXIT_CODE_BY_INTERRUPT_SIGNAL.SIGINT;
  let onInterrupt: ((signal: InterruptSignal) => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onInterrupt = signal => {
      if (cancelRequested) {
        if (Date.now() - firstSignalAt < REPEATED_SIGNAL_WINDOW_MS) {
          // The same cancellation, delivered again by a runner.
          return;
        }
        Log.warnToStderr(SESSION_MAY_BE_RUNNING_WARNING);
        process.exit(exitCode);
      }
      cancelRequested = true;
      firstSignalAt = Date.now();
      exitCode = EXIT_CODE_BY_INTERRUPT_SIGNAL[signal];
      reject(new SimulatorRequestCancelledError());
    };
  });
  const removeInterruptListener = addInterruptListener(onInterrupt!);
  // A closed stdout or stderr pipe must not crash the process before a session created after the
  // cancel is stopped.
  const removeOutputErrorGuard = ignoreOutputErrors();
  analytics.logEvent(SimulatorEvent.REQUEST_SENT, properties);
  let createPromise: Promise<T> | undefined;
  try {
    createPromise = createAsync();
    return await Promise.race([createPromise, cancelled]);
  } catch (error) {
    if (error instanceof SimulatorRequestCancelledError) {
      analytics.logEvent(SimulatorEvent.REQUEST_CANCELLED, { ...properties, reason: 'user_abort' });
      spinner.fail('Simulator session request canceled');
      const flushTimeout = new AbortController();
      // Run both at once: a session that the request returns must not wait for analytics before
      // its stop starts.
      await Promise.all([
        Promise.race([
          analytics.flushAsync(),
          sleepAsync(CANCEL_FLUSH_TIMEOUT_MS, flushTimeout.signal),
        ]).finally(() => {
          flushTimeout.abort();
        }),
        stopSessionCreatedAfterCancelAsync(createPromise, stopCreatedAsync),
      ]);
      process.exit(exitCode);
    }
    const reason = simulatorRequestFailureReason(error);
    if (reason) {
      analytics.logEvent(SimulatorEvent.REQUEST_FAILED, { ...properties, reason });
    }
    throw error;
  } finally {
    removeInterruptListener();
    removeOutputErrorGuard();
  }
}

async function stopSessionCreatedAfterCancelAsync<T>(
  createPromise: Promise<T> | undefined,
  stopCreatedAsync: (created: T) => Promise<void>
): Promise<void> {
  if (!createPromise) {
    // Ctrl+C came before the request was sent, so no session can have been created.
    return;
  }
  Log.log(
    `Waiting up to ${CANCEL_CREATE_WAIT_MS / 1_000} seconds for the request to finish, so a session it created can be stopped. Press Ctrl+C again to exit now.`
  );
  const waitTimeout = new AbortController();
  const created = await Promise.race([
    createPromise.then(
      value => ({ value }),
      () => undefined
    ),
    sleepAsync(CANCEL_CREATE_WAIT_MS, waitTimeout.signal).then(() => undefined),
  ]);
  waitTimeout.abort();
  if (created) {
    await stopCreatedAsync(created.value);
  } else {
    Log.warnToStderr(SESSION_MAY_BE_RUNNING_WARNING);
  }
}

async function agentIdentityInputAsync(): Promise<{ agentId?: string; agentSessionId?: string }> {
  if (await isAnalyticsOptedOutAsync()) {
    return {};
  }
  const agent = getAgentTelemetryContext();
  if (!agent) {
    return {};
  }
  return { agentId: agent.id, ...(agent.sessionId ? { agentSessionId: agent.sessionId } : {}) };
}
