import { Flags } from '@oclif/core';

import { getBareJobRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
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
import { sleepAsync } from '../../utils/promise';
import nullthrows from 'nullthrows';

const POLL_INTERVAL_MS = 5_000; // 5 seconds
const POLL_TIMEOUT_MS = 15 * 60 * 1_000; // 15 minutes

// Mapping enum → CLI flag value. Declared as Record<DeviceRunSessionType, string>
// so adding a new enum value in codegen fails the build until it is wired up here.
const DEVICE_RUN_SESSION_TYPE_FLAG_VALUES: Record<DeviceRunSessionType, string> = {
  [DeviceRunSessionType.AgentDevice]: 'agent-device',
};

const DEVICE_RUN_SESSION_TYPE_BY_FLAG_VALUE = Object.fromEntries(
  (Object.entries(DEVICE_RUN_SESSION_TYPE_FLAG_VALUES) as [DeviceRunSessionType, string][]).map(
    ([type, value]) => [value, type]
  )
) as Record<string, DeviceRunSessionType>;

type ReadinessResult = { ready: true; message: string } | { ready: false };
type ReadinessChecker = (logMessages: readonly string[]) => ReadinessResult;

export default class SimulatorStart extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] start a remote simulator session on EAS and get the credentials to connect to it with the CLI tool of your choice';

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
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorStart);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorStart, {
      nonInteractive: flags['non-interactive'],
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

    const checkReadiness = getReadinessCheckerForType(flags.type);

    const pollSpinner = ora(`⏳ Waiting for ${flags.type} daemon to start`).start();
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let result: ReadinessResult = { ready: false };

    try {
      while (Date.now() < deadline) {
        const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);

        if (
          session.status === DeviceRunSessionStatus.Errored ||
          session.status === DeviceRunSessionStatus.Stopped
        ) {
          throw new Error(
            `Device run session ${deviceRunSessionId} ${session.status.toLowerCase()} before the ${flags.type} daemon was ready. ${link(jobRunUrl)}`
          );
        }

        const jobRunStatus = session.turtleJobRun?.status;
        if (
          jobRunStatus === JobRunStatus.Errored ||
          jobRunStatus === JobRunStatus.Canceled ||
          jobRunStatus === JobRunStatus.Finished
        ) {
          throw new Error(
            `Turtle job run for device run session ${deviceRunSessionId} ${jobRunStatus.toLowerCase()} before the ${flags.type} daemon was ready. ${link(jobRunUrl)}`
          );
        }

        const logMessages = await fetchLogMessagesAsync(session.turtleJobRun?.logFileUrls ?? []);
        result = checkReadiness(logMessages);
        if (result.ready) {
          pollSpinner.succeed(`🎉 ${flags.type} daemon is ready`);
          break;
        }

        await sleepAsync(POLL_INTERVAL_MS);
      }
    } catch (err) {
      pollSpinner.fail(`Failed while polling for ${flags.type} daemon logs`);
      await ensureDeviceRunSessionStoppedSafelyAsync(graphqlClient, deviceRunSessionId);
      throw err;
    }

    if (!result.ready) {
      pollSpinner.fail(`Timed out waiting for ${flags.type} daemon to start`);
      await ensureDeviceRunSessionStoppedSafelyAsync(graphqlClient, deviceRunSessionId);
      throw new Error(
        `Timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s waiting for ${flags.type} daemon to start. ${link(jobRunUrl)}`
      );
    }

    Log.newLine();
    Log.log(`🔑 Run the following in your shell to attach to ${flags.type}:`);
    Log.newLine();
    Log.log(result.message);
    Log.newLine();
    Log.log(
      `When you are done, stop the session with: eas simulator:stop --id ${deviceRunSessionId}`
    );
  }
}

async function ensureDeviceRunSessionStoppedSafelyAsync(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string
): Promise<void> {
  try {
    await DeviceRunSessionMutation.ensureDeviceRunSessionStoppedAsync(
      graphqlClient,
      deviceRunSessionId
    );
  } catch (err) {
    // Cleanup is best-effort; surface the failure but don't mask the original error.
    Log.warn(
      `Failed to stop device run session ${deviceRunSessionId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function getReadinessCheckerForType(type: string): ReadinessChecker {
  switch (type) {
    case DEVICE_RUN_SESSION_TYPE_FLAG_VALUES[DeviceRunSessionType.AgentDevice]:
      return checkAgentDeviceReadiness;
    default:
      throw new Error(`Unsupported device run session type: ${type}`);
  }
}

const AGENT_DEVICE_BASE_URL_ENV_VAR = 'AGENT_DEVICE_DAEMON_BASE_URL';
const AGENT_DEVICE_AUTH_TOKEN_ENV_VAR = 'AGENT_DEVICE_DAEMON_AUTH_TOKEN';

function checkAgentDeviceReadiness(logMessages: readonly string[]): ReadinessResult {
  let baseUrl: string | undefined;
  let authToken: string | undefined;
  for (const msg of logMessages) {
    baseUrl = baseUrl ?? extractExportedEnvValue(msg, AGENT_DEVICE_BASE_URL_ENV_VAR);
    authToken = authToken ?? extractExportedEnvValue(msg, AGENT_DEVICE_AUTH_TOKEN_ENV_VAR);
    if (baseUrl && authToken) {
      break;
    }
  }
  if (baseUrl && authToken) {
    return {
      ready: true,
      message: [
        `export ${AGENT_DEVICE_BASE_URL_ENV_VAR}='${baseUrl}'`,
        `export ${AGENT_DEVICE_AUTH_TOKEN_ENV_VAR}='${authToken}'`,
      ].join('\n'),
    };
  }
  return { ready: false };
}

async function fetchLogMessagesAsync(logUrls: readonly string[]): Promise<string[]> {
  const messages: string[] = [];
  for (const url of logUrls) {
    const text = await fetchLogTextAsync(url);
    if (!text) {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      messages.push(extractLogMessage(line));
    }
  }
  return messages;
}

async function fetchLogTextAsync(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return undefined;
    }
    return await response.text();
  } catch {
    return undefined;
  }
}

function extractLogMessage(line: string): string {
  // Turtle job run logs are JSONL (bunyan-shaped), e.g.
  //   {"msg":"export FOO=\"bar\"","time":"...","logId":"..."}
  // Fall back to the raw line if it's not JSON or doesn't have a string msg.
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return line;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && 'msg' in parsed) {
      const msg = (parsed as { msg: unknown }).msg;
      if (typeof msg === 'string') {
        return msg;
      }
    }
  } catch {
    // not JSON, fall through
  }
  return line;
}

function extractExportedEnvValue(text: string, varName: string): string | undefined {
  // Matches: export NAME=value | export NAME="value" | export NAME='value'
  const pattern = new RegExp(`export\\s+${escapeRegExp(varName)}=(?:"([^"]*)"|'([^']*)'|(\\S+))`);
  const match = pattern.exec(text);
  if (!match) {
    return undefined;
  }
  return match[1] ?? match[2] ?? match[3];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
