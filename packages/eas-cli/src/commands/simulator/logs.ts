import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppPlatform } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import { downloadSimulatorArtifactAsync, hasSimulatorArtifacts } from '../../simulator/artifacts';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  type SimulatorPreview,
  fetchSimulatorPreviewJsonAsync,
  resolveSimulatorPreviewAsync,
  streamSimulatorPreviewAsync,
} from '../../simulator/preview';
import {
  formatLogLine,
  isValidLogTime,
  stripTerminalControlCharacters,
} from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import {
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';

// serve-sim keeps sending heartbeats while its log source restarts, so the stream alone cannot show a failure.
const LOG_SOURCE_HEALTH_CHECK_INTERVAL_MS = 10_000;

interface SimulatorLogLine {
  seq: number;
  at: number;
  raw: string;
}

interface SimulatorLogsSnapshot {
  device: string;
  latestSeq: number;
  oldestSeq: number;
  bufferedBytes: number;
  status: string;
  streamError: string | null;
  lines: SimulatorLogLine[];
}

export default class SimulatorLogs extends EasCommand {
  static override aliases = getSimulatorCommandAliases('logs');
  static override hiddenAliases = getSimulatorCommandHiddenAliases('logs');
  static override description =
    '[EXPERIMENTAL] show buffered logs from a remote iOS simulator session';

  static override examples = [
    '<%= config.bin %> simulator:logs --follow',
    '<%= config.bin %> simulator:logs --json',
  ];

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    artifact: Flags.integer({
      min: 1,
      description: 'Artifact index to download from a stopped session (1-based).',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Save a stopped session artifact to this path.',
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Stream new logs. Start following before performing actions to collect them.',
      exclusive: ['json'],
    }),
    scope: Flags.option({
      description: 'Show user app logs or all device logs while the session runs.',
      options: ['user-apps', 'all'] as const,
      default: 'user-apps',
    })(),
    limit: Flags.integer({
      description: 'Maximum number of buffered log lines to show while the session runs.',
      default: 100,
      min: 1,
    }),
    timestamp: Flags.boolean({
      description: 'Show timestamps in live human-readable log output.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    // Before parsing, so only the JSON result reaches stdout.
    if (this.argv.includes('--json')) {
      enableJsonOutput();
    }
    const { flags } = await this.parse(SimulatorLogs);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorLogs, { nonInteractive });
    await loadSimulatorEnvAsync(projectDir);
    const deviceRunSessionId = flags.id ?? process.env[EAS_SIMULATOR_SESSION_ID];
    if (!deviceRunSessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }
    const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);
    if (hasSimulatorArtifacts(session)) {
      if (flags.follow) {
        throw new Error(
          'The session has stopped. --follow is only available while it runs. Use --output <path> to download its logs artifact.'
        );
      }
      await downloadSimulatorArtifactAsync(session, 'simulator-log', {
        artifact: flags.artifact,
        output: flags.output,
        nonInteractive,
        json: jsonFlag,
      });
      return;
    }
    if (session.platform === AppPlatform.Android) {
      throw new Error(
        'Live logs are only available for iOS simulator sessions. This session runs an Android emulator, whose preview server does not stream logs. Start an iOS session with `eas simulator:start --platform ios` to read logs.'
      );
    }
    const preview = await resolveSimulatorPreviewAsync(session);
    if (flags.artifact !== undefined || flags.output !== undefined) {
      throw new Error(
        '--artifact and --output are only available for stopped sessions. To save live logs, follow them into a file: `eas simulator:logs --follow > logs.txt`.'
      );
    }
    const query = { scope: flags.scope, limit: String(flags.limit) };

    if (flags.follow) {
      const abortController = new AbortController();
      const interruptHandler = (): void => {
        if (abortController.signal.aborted) {
          process.exit(130);
        }
        abortController.abort();
      };
      process.on('SIGINT', interruptHandler);
      const stopHealthChecks = watchLogSourceHealth(preview, flags.scope, abortController.signal);
      try {
        await streamSimulatorPreviewAsync(
          preview,
          '/logs',
          data => {
            Log.log(flags.timestamp ? formatLogEnvelope(data) : formatLogLine(data));
          },
          {
            query: { ...query, ...(flags.timestamp ? { envelope: '1' } : {}) },
            signal: abortController.signal,
          }
        );
      } finally {
        stopHealthChecks();
        process.removeListener('SIGINT', interruptHandler);
      }
      return;
    }

    const snapshot = await fetchSimulatorPreviewJsonAsync<SimulatorLogsSnapshot>(preview, '/logs', {
      query: { ...query, snapshot: '1' },
    });
    if (!jsonFlag && snapshot.streamError) {
      Log.warn(stripTerminalControlCharacters(snapshot.streamError));
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ deviceRunSessionId: preview.deviceRunSessionId, ...snapshot });
      return;
    }
    if (snapshot.lines.length === 0) {
      // The warning above already explains why the buffer can be empty.
      if (!snapshot.streamError) {
        Log.log('No buffered logs. Use --follow to collect logs before performing actions.');
      }
      return;
    }
    for (const line of snapshot.lines) {
      Log.log(formatLogLine(line.raw, flags.timestamp, line.at));
    }
  }
}

function formatLogEnvelope(data: string): string {
  let line: Partial<SimulatorLogLine> | undefined;
  try {
    line = JSON.parse(data);
  } catch {}
  return typeof line?.raw === 'string' && isValidLogTime(line.at)
    ? formatLogLine(line.raw, true, line.at)
    : formatLogLine(data);
}

/** Polls the log source while following and reports when it stops or recovers. Returns a stop function. */
function watchLogSourceHealth(
  preview: SimulatorPreview,
  scope: string,
  signal: AbortSignal
): () => void {
  let failing = false;
  let checking = false;
  const checkAsync = async (): Promise<void> => {
    checking = true;
    try {
      const { status, streamError } = await fetchSimulatorPreviewJsonAsync<SimulatorLogsSnapshot>(
        preview,
        '/logs',
        { query: { scope, limit: '1', snapshot: '1' } }
      );
      if (signal.aborted) {
        return;
      }
      if (!failing && status !== 'streaming') {
        failing = true;
        const reason = streamError ? `: ${stripTerminalControlCharacters(streamError)}` : '';
        // stderr, so the notice stays out of `--follow > logs.txt`.
        Log.warnToStderr(
          `Simulator logs are not being collected. The session's log source stopped${reason}. It restarts automatically, and logs from this gap are missing.`
        );
      } else if (failing && status === 'streaming' && !streamError) {
        failing = false;
        Log.warnToStderr('Simulator log collection resumed.');
      }
    } catch {
      // The stream itself reports connection failures.
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => {
    if (!checking) {
      void checkAsync();
    }
  }, LOG_SOURCE_HEALTH_CHECK_INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
}
