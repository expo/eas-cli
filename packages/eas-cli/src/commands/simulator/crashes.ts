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
} from '../../simulator/preview';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

interface SimulatorCrashSummary {
  id: string;
  appName: string | null;
  procName: string | null;
  capturedAt: string | null;
  exceptionType: string | null;
  signal: string | null;
  count: number;
}

interface SimulatorCrashesSnapshot {
  meta: { status: string; statusError: string | null };
  crashes: SimulatorCrashSummary[];
}

interface SimulatorCrashDetail {
  record: SimulatorCrashSummary;
  occurrence: { logTail: string[] };
  report: string | null;
  reportError: string | null;
}

export default class SimulatorCrashes extends EasCommand {
  static override aliases = ['sim:crashes'];
  static override description =
    '[EXPERIMENTAL] show crash reports from a remote iOS simulator session\n\n' +
    'For logs during a crash reproduction, start eas simulator:logs --follow --scope all first.';

  static override examples = [
    '<%= config.bin %> simulator:crashes --json',
    '<%= config.bin %> simulator:crashes --report-id <report-id>',
  ];

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    'report-id': Flags.string({
      description: 'Show the newest occurrence of a crash. Use an ID from the crash list.',
    }),
    timestamp: Flags.boolean({
      description: 'Show timestamps in human-readable crash summaries.',
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
    const { flags } = await this.parse(SimulatorCrashes);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorCrashes, { nonInteractive });
    const preview = await resolveSimulatorPreviewAsync(graphqlClient, projectDir, flags.id);
    const snapshot = await fetchSimulatorPreviewJsonAsync<SimulatorCrashesSnapshot>(
      preview,
      '/crashes'
    );
    if (!jsonFlag && snapshot.meta.statusError) {
      Log.warn(sanitizeSimulatorText(snapshot.meta.statusError));
    }

    if (flags['report-id']) {
      const detail = await fetchSimulatorPreviewJsonAsync<SimulatorCrashDetail>(
        preview,
        `/crashes/${encodeURIComponent(flags['report-id'])}`
      );
      if (jsonFlag) {
        printJsonOnlyOutput({ deviceRunSessionId: preview.deviceRunSessionId, ...detail });
        return;
      }
      Log.log(formatCrashSummary(detail.record, flags.timestamp));
      if (detail.report !== null) {
        Log.log(sanitizeSimulatorText(detail.report));
      } else {
        Log.warn(
          sanitizeSimulatorText(
            detail.reportError ??
              'The crash report is unavailable. The session recorded the crash but did not return its report. The log lines recorded with the crash follow.'
          )
        );
        for (const line of detail.occurrence.logTail) {
          Log.log(sanitizeSimulatorText(line));
        }
      }
      return;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ deviceRunSessionId: preview.deviceRunSessionId, ...snapshot });
      return;
    }
    for (const crash of snapshot.crashes) {
      Log.log(formatCrashSummary(crash, flags.timestamp));
    }
    if (snapshot.crashes.length === 0) {
      Log.log('No crash reports have been recorded. Reports can take a few seconds to appear.');
    }
  }
}

function formatCrashSummary(crash: SimulatorCrashSummary, timestamp = false): string {
  const prefix = timestamp
    ? `${chalk.dim(sanitizeSimulatorText(crash.capturedAt ?? 'Unknown time'))}  `
    : '';
  const appName = chalk.bold(
    sanitizeSimulatorText(crash.appName ?? crash.procName ?? 'Unknown app')
  );
  const exception = chalk.red.bold(
    sanitizeSimulatorText(crash.exceptionType ?? crash.signal ?? 'Unknown exception')
  );
  const count = chalk.dim(
    sanitizeSimulatorText(`(${crash.count} occurrence${crash.count === 1 ? '' : 's'})`)
  );
  return `${prefix}${appName}  ${exception}  ${count}  ${chalk.dim(sanitizeSimulatorText(crash.id))}`;
}
