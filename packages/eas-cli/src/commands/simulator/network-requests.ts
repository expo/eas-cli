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
  type NetworkRequestSummary,
  downloadNetworkCaptureAsync,
  readNetworkRequestsAsync,
  streamNetworkRequestsAsync,
} from '../../simulator/networkRequests';
import { resolveSimulatorPreviewAsync, sanitizeSimulatorText } from '../../simulator/preview';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorNetworkRequests extends EasCommand {
  static override aliases = ['sim:network-requests'];
  static override description =
    '[EXPERIMENTAL] inspect completed network requests from a capture-enabled simulator session';

  static override examples = [
    '<%= config.bin %> simulator:network-requests --json',
    '<%= config.bin %> simulator:network-requests --follow --timestamp',
    '<%= config.bin %> simulator:network-requests --request-id r1 --json',
    '<%= config.bin %> simulator:network-requests --output capture.har',
  ];

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    'request-id': Flags.string({
      description:
        'Show a captured request, including the headers and bodies selected for capture.',
      exclusive: ['output'],
    }),
    output: Flags.string({
      char: 'o',
      description: 'Save the complete HAR to a new file before the session stops.',
      exclusive: ['request-id'],
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Stream completed requests, including those retained by the current capture.',
      exclusive: ['json', 'request-id', 'output', 'limit'],
    }),
    limit: Flags.integer({
      description: 'Maximum number of recent requests to list without --follow.',
      default: 100,
      min: 1,
    }),
    timestamp: Flags.boolean({
      description: 'Show request start timestamps in human-readable lists.',
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
    const { flags } = await this.parse(SimulatorNetworkRequests);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorNetworkRequests, { nonInteractive });
    const preview = await resolveSimulatorPreviewAsync(graphqlClient, projectDir, flags.id);
    if (flags.follow) {
      await streamNetworkRequestsAsync(preview, request => {
        Log.log(formatRequestSummary(request, flags.timestamp));
      });
      return;
    }
    if (flags.output) {
      const filePath = await downloadNetworkCaptureAsync(preview, flags.output);
      if (jsonFlag) {
        printJsonOnlyOutput({ deviceRunSessionId: preview.deviceRunSessionId, filePath });
      } else {
        Log.log(`Saved network capture to ${sanitizeSimulatorText(filePath)}.`);
      }
      return;
    }
    const result = await readNetworkRequestsAsync(preview, {
      limit: flags.limit,
      requestId: flags['request-id'],
    });
    if (jsonFlag) {
      printJsonOnlyOutput({
        deviceRunSessionId: preview.deviceRunSessionId,
        ...(Array.isArray(result) ? { requests: result } : { request: result }),
      });
    } else if (!Array.isArray(result)) {
      Log.log(sanitizeSimulatorText(JSON.stringify(result, null, 2)));
    } else if (result.length === 0) {
      Log.log(
        'No completed network requests were captured. Initial-launch requests may have been missed.'
      );
    } else {
      for (const request of result) {
        Log.log(formatRequestSummary(request, flags.timestamp));
      }
    }
  }
}

function formatRequestSummary(request: NetworkRequestSummary, timestamp = false): string {
  let status = sanitizeSimulatorText(String(request.status));
  if (request.status === 0 || request.status >= 500) {
    status = chalk.red(status);
  } else if (request.status >= 400) {
    status = chalk.yellow(status);
  } else if (request.status >= 300) {
    status = chalk.cyan(status);
  } else if (request.status >= 200) {
    status = chalk.green(status);
  }
  const fields = [
    chalk.dim(sanitizeSimulatorText(request.id ?? '-').padEnd(5)),
    chalk.bold.cyan(sanitizeSimulatorText(request.method).padEnd(6)),
    sanitizeSimulatorText(request.url),
    status,
    chalk.dim(sanitizeSimulatorText(`${Math.round(request.duration * 10) / 10}ms`)),
  ];
  if (timestamp) {
    fields.unshift(chalk.dim(sanitizeSimulatorText(request.startedDateTime)));
  }
  return fields.join('  ');
}
