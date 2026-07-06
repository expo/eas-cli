import { Flags } from '@oclif/core';
import nullthrows from 'nullthrows';

import { getDeviceRunSessionUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import {
  AppPlatform,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  JobRunStatus,
} from '../../graphql/generated';
import { DeviceRunSessionMutation } from '../../graphql/mutations/DeviceRunSessionMutation';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
  resetSimulatorEnvAsync,
  writeSimulatorEnvAsync,
} from '../../simulator/env';
import {
  DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE,
  DEVICE_RUN_SESSION_TYPE_FLAG_VALUES,
  DeviceRunSessionRemoteConfig,
  formatRemoteSessionInstructions,
  getRemoteSessionEnvironmentVariables,
} from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { sleepAsync } from '../../utils/promise';

const POLL_INTERVAL_MS = 5_000; // 5 seconds
const POLL_TIMEOUT_MS = 15 * 60 * 1_000; // 15 minutes
const OUT_CONFIG_TYPE_VALUES = {
  Env: 'env',
  Dotenv: 'dotenv',
} as const;

export default class SimulatorStart extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] start a remote simulator session on EAS and get instructions to connect to it';

  static override flags = {
    platform: Flags.option({
      description: 'Device platform',
      options: ['android', 'ios'] as const,
      required: true,
    })(),
    type: Flags.option({
      description: 'Type of simulator session to create',
      options: Object.values(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES),
      default: DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.AgentDevice],
    })(),
    'package-version': Flags.string({
      description:
        'Version of the package backing the simulator session (e.g. "0.1.3-alpha.3"). Defaults to "latest" when omitted.',
    }),
    'max-duration-minutes': Flags.integer({
      description:
        'Maximum duration of the simulator session in minutes before it is automatically stopped. Only customizable on paid plans. Defaults to a value derived from the job run priority when omitted.',
      min: 0,
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
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorStart);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectId,
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorStart, {
      nonInteractive,
    });

    await loadSimulatorEnvAsync(projectDir);
    const existingDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];
    if (existingDeviceRunSessionId && !flags.force) {
      throw new Error(
        `Existing simulator session in environment. Use --force to create a new simulator session.`
      );
    }
    if (existingDeviceRunSessionId) {
      Log.warn(
        `  Overwriting previous simulator session (id: ${existingDeviceRunSessionId}). ` +
          `The previous remote session will continue running until stopped. ` +
          `To stop it, run: eas simulator:stop --id ${existingDeviceRunSessionId}`
      );
      Log.newLine();
    }

    const platform = flags.platform === 'android' ? AppPlatform.Android : AppPlatform.Ios;

    const createSpinner = ora('🚀 Creating simulator session').start();
    let deviceRunSessionId: string;
    let deviceRunSessionUrl: string;
    try {
      const session = await DeviceRunSessionMutation.createDeviceRunSessionAsync(graphqlClient, {
        appId: projectId,
        platform,
        type: DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE[flags.type],
        packageVersion: flags['package-version'],
        maxRunTimeMinutes: flags['max-duration-minutes'],
      });
      deviceRunSessionId = session.id;
      nullthrows(session.turtleJobRun?.id, 'Expected simulator session to start');
      deviceRunSessionUrl = getDeviceRunSessionUrl(
        session.app.ownerAccount.name,
        session.app.slug,
        deviceRunSessionId
      );
      const simulatorEnvWritten =
        !jsonFlag && flags['out-config-type'] === OUT_CONFIG_TYPE_VALUES.Dotenv
          ? await writeSimulatorEnvSafelyAsync(projectDir, {
              [EAS_SIMULATOR_SESSION_ID]: deviceRunSessionId,
            })
          : false;
      createSpinner.succeed(
        `Simulator session created (id: ${deviceRunSessionId}${
          simulatorEnvWritten ? `, saved to ${SIMULATOR_DOTENV_FILE_NAME}` : ''
        }) ${link(deviceRunSessionUrl)}`
      );
    } catch (err) {
      createSpinner.fail('Failed to create simulator session');
      throw err;
    }

    const pollSpinner = ora(`⏳ Waiting for ${flags.type} session to be ready`).start();
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let remoteConfig: DeviceRunSessionRemoteConfig | undefined;

    try {
      while (Date.now() < deadline) {
        const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);

        if (
          session.status === DeviceRunSessionStatus.Errored ||
          session.status === DeviceRunSessionStatus.Stopped
        ) {
          throw new Error(
            `Simulator session ${deviceRunSessionId} ${session.status.toLowerCase()} before the ${flags.type} session was ready. ${link(deviceRunSessionUrl)}`
          );
        }

        const jobRunStatus = session.turtleJobRun?.status;
        if (
          jobRunStatus === JobRunStatus.Errored ||
          jobRunStatus === JobRunStatus.Canceled ||
          jobRunStatus === JobRunStatus.Finished
        ) {
          throw new Error(
            `Turtle job run for simulator session ${deviceRunSessionId} ${jobRunStatus.toLowerCase()} before the ${flags.type} session was ready. ${link(deviceRunSessionUrl)}`
          );
        }

        if (session.remoteConfig) {
          remoteConfig = session.remoteConfig;
          pollSpinner.succeed(`🎉 ${flags.type} session is ready`);
          break;
        }

        await sleepAsync(POLL_INTERVAL_MS);
      }
    } catch (err) {
      pollSpinner.fail(`Failed while polling for ${flags.type} session to be ready`);
      await ensureDeviceRunSessionStoppedSafelyAsync(graphqlClient, deviceRunSessionId);
      throw err;
    }

    if (!remoteConfig) {
      pollSpinner.fail(`Timed out waiting for ${flags.type} session to be ready`);
      await ensureDeviceRunSessionStoppedSafelyAsync(graphqlClient, deviceRunSessionId);
      throw new Error(
        `Timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s waiting for ${flags.type} session to be ready. ${link(deviceRunSessionUrl)}`
      );
    }

    if (flags['out-config-type'] === OUT_CONFIG_TYPE_VALUES.Dotenv) {
      await writeSimulatorEnvSafelyAsync(projectDir, {
        ...getRemoteSessionEnvironmentVariables(remoteConfig),
        [EAS_SIMULATOR_SESSION_ID]: deviceRunSessionId,
      });
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: deviceRunSessionId,
        type: flags.type,
        deviceRunSessionUrl,
        remoteConfig,
      });
      return;
    }

    Log.newLine();
    Log.log(formatRemoteSessionInstructions(remoteConfig, flags['out-config-type']));
    Log.newLine();

    if (nonInteractive) {
      Log.log(
        `When you are done, stop the session with: eas simulator:stop --id ${deviceRunSessionId}`
      );
      return;
    }

    await waitForSessionEndOrInterruptAsync({
      graphqlClient,
      deviceRunSessionId,
      deviceRunSessionUrl,
      projectDir,
    });
  }
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
}: {
  graphqlClient: ExpoGraphqlClient;
  deviceRunSessionId: string;
  deviceRunSessionUrl: string;
  projectDir: string;
}): Promise<void> {
  const spinner = ora(
    `Simulator session active — press Ctrl+C to stop, or run \`eas simulator:stop --id ${deviceRunSessionId}\` from another shell`
  ).start();

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
  const sigintHandler = (): void => {
    if (signal.aborted) {
      // Force exit on a second Ctrl+C in case cleanup is hanging. The session may still be
      // running on EAS, so tell the user how to make sure it gets terminated.
      spinner.fail(
        `Aborted before the simulator session could be stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
      );
      process.exit(130);
    }
    abortController.abort();
  };
  process.on('SIGINT', sigintHandler);

  try {
    while (!signal.aborted) {
      let session;
      try {
        session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);
      } catch (err) {
        Log.debug(
          `Failed to poll simulator session: ${err instanceof Error ? err.message : String(err)}`
        );
        await Promise.race([sleepAsync(POLL_INTERVAL_MS), abortPromise]);
        continue;
      }

      const jobRunStatus = session.turtleJobRun?.status;
      if (
        session.status === DeviceRunSessionStatus.Errored ||
        jobRunStatus === JobRunStatus.Errored
      ) {
        spinner.fail(`Simulator session errored. ${link(deviceRunSessionUrl)}`);
        throw new Error(`Simulator session ${deviceRunSessionId} errored.`);
      }
      if (
        session.status === DeviceRunSessionStatus.Stopped ||
        jobRunStatus === JobRunStatus.Canceled ||
        jobRunStatus === JobRunStatus.Finished
      ) {
        spinner.succeed(`Simulator session ended. ${link(deviceRunSessionUrl)}`);
        await resetSimulatorEnvVerboseAsync(projectDir);
        return;
      }

      await Promise.race([sleepAsync(POLL_INTERVAL_MS), abortPromise]);
    }

    spinner.text = 'Stopping simulator session...';
    const stopped = await ensureDeviceRunSessionStoppedSafelyAsync(
      graphqlClient,
      deviceRunSessionId
    );
    if (stopped) {
      spinner.succeed('Simulator session stopped');
      await resetSimulatorEnvVerboseAsync(projectDir);
    } else {
      spinner.fail(
        `Could not confirm the simulator session was stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
      );
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }
}

async function resetSimulatorEnvVerboseAsync(projectDir: string): Promise<void> {
  try {
    await resetSimulatorEnvAsync(projectDir);
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
