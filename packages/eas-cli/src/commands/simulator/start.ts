import { Flags } from '@oclif/core';
import * as fs from 'fs-extra';
import path from 'path';
import nullthrows from 'nullthrows';

import { getBareJobRunUrl } from '../../build/utils/url';
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
      description: 'Type of device run session to create',
      options: Object.values(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES),
      default: DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.AgentDevice],
    })(),
    'package-version': Flags.string({
      description:
        'Version of the package backing the device run session (e.g. "0.1.3-alpha.3"). Defaults to "latest" when omitted.',
    }),
    'out-config-type': Flags.option({
      description:
        'How to output simulator connection configuration. Use "env" to print shell exports, or "dotenv" to write .env.local.',
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

    const platform = flags.platform === 'android' ? AppPlatform.Android : AppPlatform.Ios;

    const createSpinner = ora('🚀 Creating device run session').start();
    let deviceRunSessionId: string;
    let jobRunUrl: string;
    try {
      const session = await DeviceRunSessionMutation.createDeviceRunSessionAsync(graphqlClient, {
        appId: projectId,
        platform,
        type: DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE[flags.type],
        packageVersion: flags['package-version'],
      });
      deviceRunSessionId = session.id;
      const jobRunId = nullthrows(session.turtleJobRun?.id, 'Expected device run session to start');
      jobRunUrl = getBareJobRunUrl(session.app.ownerAccount.name, session.app.slug, jobRunId);
      createSpinner.succeed(
        `Device run session created (id: ${deviceRunSessionId}) ${link(jobRunUrl)}`
      );
    } catch (err) {
      createSpinner.fail('Failed to create device run session');
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
            `Device run session ${deviceRunSessionId} ${session.status.toLowerCase()} before the ${flags.type} session was ready. ${link(jobRunUrl)}`
          );
        }

        const jobRunStatus = session.turtleJobRun?.status;
        if (
          jobRunStatus === JobRunStatus.Errored ||
          jobRunStatus === JobRunStatus.Canceled ||
          jobRunStatus === JobRunStatus.Finished
        ) {
          throw new Error(
            `Turtle job run for device run session ${deviceRunSessionId} ${jobRunStatus.toLowerCase()} before the ${flags.type} session was ready. ${link(jobRunUrl)}`
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
        `Timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s waiting for ${flags.type} session to be ready. ${link(jobRunUrl)}`
      );
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: deviceRunSessionId,
        type: flags.type,
        jobRunUrl,
        remoteConfig,
      });
      return;
    }

    if (flags['out-config-type'] === OUT_CONFIG_TYPE_VALUES.Dotenv) {
      await writeRemoteSessionEnvironmentVariablesToEnvLocalSafelyAsync(
        projectDir,
        remoteConfig,
        deviceRunSessionId
      );
    } else {
      Log.newLine();
      Log.log(formatRemoteSessionInstructions(remoteConfig));
      Log.newLine();
    }

    if (nonInteractive) {
      Log.log(
        `When you are done, stop the session with: eas simulator:stop --id ${deviceRunSessionId}`
      );
      return;
    }

    await waitForSessionEndOrInterruptAsync({
      graphqlClient,
      deviceRunSessionId,
      jobRunUrl,
    });
  }
}

async function writeRemoteSessionEnvironmentVariablesToEnvLocalSafelyAsync(
  projectDir: string,
  remoteConfig: DeviceRunSessionRemoteConfig,
  deviceRunSessionId: string
): Promise<void> {
  const environmentVariables = {
    ...getRemoteSessionEnvironmentVariables(remoteConfig),
    EAS_SIMULATOR_SESSION_ID: deviceRunSessionId,
  };
  if (Object.keys(environmentVariables).length === 0) {
    return;
  }

  try {
    await appendEnvironmentVariablesToEnvLocalAsync(projectDir, environmentVariables);
    Log.newLine();
    Log.withTick('Wrote simulator environment variables to .env.local');
    Log.newLine();
    Log.log('🔑 Run the following to use agent-device with the simulator:');
    Log.newLine();
    Log.log('eas simulator:exec agent-device <command>');
    if (
      remoteConfig.__typename === 'AgentDeviceRunSessionRemoteConfig' &&
      remoteConfig.webPreviewUrl
    ) {
      Log.newLine();
      Log.log('🌐 Open the following URL in your browser to preview the simulator:');
      Log.newLine();
      Log.log(remoteConfig.webPreviewUrl);
    }
    Log.newLine();
  } catch (err) {
    Log.warn(
      `Failed to write simulator environment variables to .env.local: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function appendEnvironmentVariablesToEnvLocalAsync(
  projectDir: string,
  environmentVariables: Record<string, string>
): Promise<void> {
  const envLocalPath = path.join(projectDir, '.env.local');
  let prefix = '';

  if (await fs.pathExists(envLocalPath)) {
    const existingContent = await fs.readFile(envLocalPath, 'utf8');
    if (existingContent.length > 0 && !existingContent.endsWith('\n')) {
      prefix = '\n';
    }
  }

  const envLocalContent =
    Object.entries(environmentVariables)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n';

  await fs.appendFile(envLocalPath, prefix + envLocalContent);
}

async function waitForSessionEndOrInterruptAsync({
  graphqlClient,
  deviceRunSessionId,
  jobRunUrl,
}: {
  graphqlClient: ExpoGraphqlClient;
  deviceRunSessionId: string;
  jobRunUrl: string;
}): Promise<void> {
  const spinner = ora(
    `Device run session active — press Ctrl+C to stop, or run \`eas simulator:stop --id ${deviceRunSessionId}\` from another shell`
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
        `Aborted before the device run session could be stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
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
          `Failed to poll device run session: ${err instanceof Error ? err.message : String(err)}`
        );
        await Promise.race([sleepAsync(POLL_INTERVAL_MS), abortPromise]);
        continue;
      }

      const jobRunStatus = session.turtleJobRun?.status;
      if (
        session.status === DeviceRunSessionStatus.Errored ||
        jobRunStatus === JobRunStatus.Errored
      ) {
        spinner.fail(`Device run session errored. ${link(jobRunUrl)}`);
        throw new Error(`Device run session ${deviceRunSessionId} errored.`);
      }
      if (
        session.status === DeviceRunSessionStatus.Stopped ||
        jobRunStatus === JobRunStatus.Canceled ||
        jobRunStatus === JobRunStatus.Finished
      ) {
        spinner.succeed(`Device run session ended. ${link(jobRunUrl)}`);
        return;
      }

      await Promise.race([sleepAsync(POLL_INTERVAL_MS), abortPromise]);
    }

    spinner.text = 'Stopping device run session...';
    const stopped = await ensureDeviceRunSessionStoppedSafelyAsync(
      graphqlClient,
      deviceRunSessionId
    );
    if (stopped) {
      spinner.succeed('Device run session stopped');
    } else {
      spinner.fail(
        `Could not confirm the device run session was stopped. Run \`eas simulator:stop --id ${deviceRunSessionId}\` to terminate it and avoid unexpected charges.`
      );
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
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
      `Failed to stop device run session ${deviceRunSessionId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}
