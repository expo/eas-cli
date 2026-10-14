import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import { downloadSimulatorArtifactAsync, hasSimulatorArtifacts } from '../../simulator/artifacts';
import { ora } from '../../ora';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  type NetworkRequestSummary,
  downloadNetworkCaptureAsync,
  readNetworkRequestsAsync,
  streamNetworkRequestsAsync,
} from '../../simulator/networkRequests';
import { resolveSimulatorPreviewAsync } from '../../simulator/preview';
import { stripTerminalControlCharacters } from '../../simulator/utils';
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
    artifact: Flags.integer({
      min: 1,
      description: 'Artifact index to download from a stopped session (1-based).',
    }),
    'request-id': Flags.string({
      description:
        'Show a captured request, including the headers and bodies selected for capture.',
      exclusive: ['output'],
    }),
    output: Flags.string({
      char: 'o',
      description: 'Save the live HAR or a stopped session capture artifact to this path.',
      exclusive: ['request-id'],
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Stream completed requests, including those retained by the current capture.',
      exclusive: ['request-id', 'output', 'limit'],
    }),
    limit: Flags.integer({
      description: 'Maximum number of recent live requests to list without --follow.',
      default: 100,
      min: 1,
    }),
    timestamp: Flags.boolean({
      description: 'Show request start timestamps in live human-readable lists.',
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
    if (jsonFlag && flags.follow) {
      throw new Error('Use either --json or --follow, not both.');
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorNetworkRequests, { nonInteractive });
    await loadSimulatorEnvAsync(projectDir);
    const deviceRunSessionId = flags.id ?? process.env[EAS_SIMULATOR_SESSION_ID];
    if (!deviceRunSessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }
    const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);
    if (hasSimulatorArtifacts(session)) {
      if (flags.follow || flags['request-id']) {
        throw new Error(
          'The session has stopped. --follow and --request-id are only available while it runs. Use --output <path> to download its capture artifact.'
        );
      }
      await downloadSimulatorArtifactAsync(session, 'network-capture', {
        artifact: flags.artifact,
        output: flags.output,
        nonInteractive,
        json: jsonFlag,
      });
      return;
    }
    const preview = await resolveSimulatorPreviewAsync(session);
    if (flags.artifact !== undefined) {
      throw new Error(
        '--artifact is only available for stopped sessions. Use --output <path> to save the live HAR.'
      );
    }

    if (flags.follow) {
      const abortController = new AbortController();
      const interruptHandler = (): void => {
        if (abortController.signal.aborted) {
          process.exit(130);
        }
        abortController.abort();
      };
      process.on('SIGINT', interruptHandler);
      try {
        await streamNetworkRequestsAsync(
          preview,
          request => {
            Log.log(formatRequestSummary(request, flags.timestamp));
          },
          abortController.signal
        );
      } finally {
        process.removeListener('SIGINT', interruptHandler);
      }
      return;
    }

    if (flags.output) {
      const downloadSpinner = jsonFlag ? null : ora('Saving network capture').start();
      let filePath: string;
      try {
        filePath = await downloadNetworkCaptureAsync(preview, flags.output);
        downloadSpinner?.succeed(`Saved network capture to ${filePath}`);
      } catch (err) {
        downloadSpinner?.fail('Failed to save network capture');
        throw err;
      }
      if (jsonFlag) {
        printJsonOnlyOutput({ deviceRunSessionId: preview.deviceRunSessionId, filePath });
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
      Log.log(
        stripTerminalControlCharacters(JSON.stringify(result, null, 2), {
          keepNewlinesAndTabs: true,
        })
      );
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
  let status = String(request.status);
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
    chalk.dim(stripTerminalControlCharacters(request.id ?? '-').padEnd(5)),
    chalk.bold.cyan(stripTerminalControlCharacters(request.method).padEnd(6)),
    stripTerminalControlCharacters(request.url),
    status,
    chalk.dim(`${Math.round(request.duration * 10) / 10}ms`),
  ];
  if (timestamp) {
    fields.unshift(chalk.dim(stripTerminalControlCharacters(request.startedDateTime)));
  }
  return fields.join('  ');
}
