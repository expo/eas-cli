import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import Log from '../../log';
import { SIMULATOR_DOTENV_FILE_NAME } from '../../simulator/env';
import {
  fetchSimulatorPreviewJsonAsync,
  resolveSimulatorPreviewAsync,
  sanitizeSimulatorText,
  streamSimulatorPreviewAsync,
} from '../../simulator/preview';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

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
  static override aliases = ['sim:logs'];
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
    follow: Flags.boolean({
      char: 'f',
      description: 'Stream new logs. Start following before performing actions to collect them.',
      exclusive: ['json'],
    }),
    scope: Flags.option({
      description: 'Show user app logs or all device logs.',
      options: ['user-apps', 'all'] as const,
      default: 'user-apps',
    })(),
    limit: Flags.integer({
      description: 'Maximum number of buffered log lines to show.',
      default: 100,
      min: 1,
    }),
    timestamp: Flags.boolean({
      description: 'Show timestamps in human-readable log output.',
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
    const preview = await resolveSimulatorPreviewAsync(graphqlClient, projectDir, flags.id);
    const query = { scope: flags.scope, limit: String(flags.limit) };

    if (flags.follow) {
      await streamSimulatorPreviewAsync(
        preview,
        '/logs',
        data => {
          if (flags.timestamp) {
            const line = JSON.parse(data) as SimulatorLogLine;
            Log.log(formatLogLine(line.raw, true, line.at));
          } else {
            Log.log(formatLogLine(data));
          }
        },
        { ...query, ...(flags.timestamp ? { envelope: '1' } : {}) }
      );
      return;
    }

    const snapshot = await fetchSimulatorPreviewJsonAsync<SimulatorLogsSnapshot>(preview, '/logs', {
      ...query,
      snapshot: '1',
    });
    if (jsonFlag) {
      printJsonOnlyOutput({ deviceRunSessionId: preview.deviceRunSessionId, ...snapshot });
      return;
    }
    if (snapshot.streamError) {
      Log.warn(sanitizeSimulatorText(snapshot.streamError));
    }
    for (const line of snapshot.lines) {
      Log.log(formatLogLine(line.raw, flags.timestamp, line.at));
    }
    if (snapshot.lines.length === 0) {
      Log.log('No buffered logs. Use --follow to collect logs before performing actions.');
    }
  }
}

function formatLogLine(raw: string, timestamp = false, at = Date.now()): string {
  try {
    const entry = JSON.parse(raw) as {
      timestamp?: string;
      processImagePath?: string;
      processID?: number;
      eventMessage?: string;
      messageType?: string | number;
    };
    if (typeof entry.eventMessage === 'string') {
      const prefix = timestamp
        ? `${chalk.dim(sanitizeSimulatorText(entry.timestamp ?? new Date(at).toISOString()))}  `
        : '';
      const processName = entry.processImagePath?.split('/').at(-1) ?? 'unknown';
      const processId = typeof entry.processID === 'number' ? `:${entry.processID}` : '';
      const processLabel = chalk.cyan(sanitizeSimulatorText(`[${processName}${processId}]`));
      const level = String(entry.messageType ?? '').toLowerCase();
      let message = sanitizeSimulatorText(entry.eventMessage);
      if (level === 'error' || level === '16') {
        message = chalk.red(message);
      } else if (level === 'fault' || level === '17') {
        message = chalk.red.bold(message);
      } else if (level === 'debug' || level === '2') {
        message = chalk.dim(message);
      }
      return `${prefix}${processLabel} ${message}`;
    }
  } catch {}
  const prefix = timestamp ? `${chalk.dim(new Date(at).toISOString())}  ` : '';
  return `${prefix}${sanitizeSimulatorText(raw)}`;
}
