import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppPlatform, DeviceRunSessionStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import {
  ControlAction,
  executeControlActionAsync,
  parseControlActionOutput,
  prepareControlActionAsync,
} from '../../simulator/controlActions';
import {
  ControlConfigExecutionError,
  ControlConfigResult,
  PreparedControlConfig,
  executeControlConfigAsync,
  prepareControlConfigAsync,
  serializeControlConfigResults,
} from '../../simulator/controlConfig';
import { runControlMenuAsync } from '../../simulator/controlInteractive';
import { ControlPromptCancelledError } from '../../simulator/controlPrompts';
import { ControlSessionEndedError, watchControlSession } from '../../simulator/controlSession';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  HostActionCatalog,
  HostActionCatalogEntry,
  HostActionConnection,
  HostActionDevice,
  buildHostActionParams,
  connectHostActionsAsync,
  fetchHostActionCatalogAsync,
  fetchHostActionDeviceAsync,
  formatHostActionUsage,
} from '../../simulator/hostActions';
import { PreviewApiAccess, getPreviewApiAccess } from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import formatFields from '../../utils/formatFields';
import { sanitizeTerminalText, truncate } from '../../utils/terminalText';
import { formatMilliseconds } from '../../utils/timer';

type ControlSession = {
  id: string;
  name: string | null;
  project: string;
  status: DeviceRunSessionStatus;
  device: HostActionDevice;
};

export default class SimulatorControl extends EasCommand {
  static override aliases = ['sim:control'];
  static override description = `[EXPERIMENTAL] control a remote iOS simulator session on EAS

Run without an action to open the menu, or use --list to see available actions. Use <action> --help for usage.

Use --import to run saved actions from a JSON file:
{
  "version": 1,
  "actions": [{"action": "appearance.set", "params": {"value": "dark"}}]
}

The file is checked before any actions run. Actions run in order and stop on the first failure. Local paths are relative to the JSON file; paths in params refer to the simulator host.

Existing output files are overwritten. When saving to a directory, an existing file with the generated name causes the action to fail.`;
  static override strict = false;

  static override examples = [
    '$ eas simulator:control',
    '$ eas simulator:control --id <session-id>',
    '$ eas simulator:control screenshot.capture --help',
    '$ eas simulator:control clipboard.write -- --some-text',
    '$ eas simulator:control --import ./simulator-control.json',
    '$ eas simulator:control hardwareKeyboard.set off',
    '$ eas simulator:control permissions.set grant camera com.example.app',
    '$ eas simulator:control app.install ./MyApp.ipa',
    '$ eas simulator:control screenshot.capture --output ./screenshot.png',
    '$ eas simulator:control screenshot.capture --output ./screenshot.png --id <session-id>',
  ];

  static override args = {
    action: Args.string({
      description:
        'Action name, followed by values or name=value pairs. Omit to open the menu. Use -- before values starting with --.',
    }),
  };

  static override flags = {
    help: Flags.boolean({
      char: 'h',
      description: 'Show help for this command or the selected action',
    }),
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    list: Flags.boolean({
      description: 'List available actions',
    }),
    output: Flags.string({
      description: 'Local file or existing directory for saved output',
    }),
    import: Flags.string({
      description: 'Run saved actions from a JSON file',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { args, argv, flags } = await this.parse(SimulatorControl);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }
    if (flags.id === '') {
      throw new Error('--id needs a simulator session ID.');
    }
    const action = flags.list && !flags.help ? undefined : args.action;
    const importing = flags.import !== undefined;
    if (importing && (args.action || flags.list || flags.output !== undefined)) {
      throw new Error('--import cannot be combined with an action, --list, or --output.');
    }
    const interactive = !flags.list && !action && !importing;
    if (!action && flags.output) {
      throw new Error(
        '--output requires an action. Choose an output path when selecting a file action in the interactive menu.'
      );
    }
    if (interactive && (nonInteractive || !process.stdin.isTTY)) {
      throw new Error(
        'No action provided. Run `eas simulator:control --list` to see the actions, then `eas simulator:control <action> [values...]`.'
      );
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorControl, {
      nonInteractive,
    });

    await loadSimulatorEnvAsync(projectDir);
    const sessionId = flags.id ?? process.env[EAS_SIMULATOR_SESSION_ID];
    if (!sessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const spinner = ora(`Connecting to simulator session ${sessionId}`).start();
    let connection: HostActionConnection | undefined;
    try {
      let catalog: HostActionCatalog;
      let controlSession: ControlSession;
      try {
        const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, sessionId);
        const access = assertControllableSession(session);
        connection = await connectHostActionsAsync(access);
        catalog = await fetchHostActionCatalogAsync(connection);
        controlSession = {
          id: session.id,
          name: session.name ?? null,
          project: `@${session.app.ownerAccount.name}/${session.app.slug}`,
          status: session.status,
          device:
            interactive || importing || (jsonFlag && !flags.list && !flags.help)
              ? await fetchHostActionDeviceAsync(access, connection.udid)
              : { udid: connection.udid },
        };
        spinner.succeed(`Connected to simulator session ${sessionId}`);
      } catch (err) {
        spinner.fail(`Failed to connect to simulator session ${sessionId}`);
        throw err;
      }
      if (flags.list && !flags.help) {
        this.printCatalog(catalog, jsonFlag);
        return;
      }
      if (flags.help && action) {
        const entry = Object.hasOwn(catalog, action) ? catalog[action] : undefined;
        if (!entry) {
          throw new Error(
            `Unknown simulator action "${action}". Run \`eas simulator:control --list\` to see the actions.`
          );
        }
        this.printActionHelp(action, entry, jsonFlag);
        return;
      }
      const activeConnection = connection;
      const runActionAsync = async (selection: ControlAction): Promise<void> => {
        await this.runActionAsync(activeConnection, catalog, selection, {
          session: controlSession,
          jsonFlag,
          interactive,
        });
      };
      if (interactive) {
        this.printSessionHeader(controlSession);
        const controller = new AbortController();
        const onConnectionLost = (): void => {
          controller.abort(activeConnection.signal.reason);
        };
        const onInterrupt = (): void => {
          controller.abort(new ControlPromptCancelledError());
        };
        activeConnection.signal.addEventListener('abort', onConnectionLost, { once: true });
        if (activeConnection.signal.aborted) {
          onConnectionLost();
        }
        process.on('SIGINT', onInterrupt);
        const session = watchControlSession(graphqlClient, sessionId, {
          signal: controller.signal,
        });
        const detach = (): void => {
          activeConnection.close();
        };
        session.signal.addEventListener('abort', detach, { once: true });
        try {
          await runControlMenuAsync({
            catalog,
            signal: session.signal,
            runActionAsync,
          });
        } catch (error) {
          const reason: unknown = session.signal.aborted ? session.signal.reason : error;
          if (reason instanceof ControlPromptCancelledError) {
            process.exitCode = 130;
          } else if (reason instanceof ControlSessionEndedError) {
            if (reason.failed) {
              throw reason;
            }
            Log.log(reason.message);
          } else {
            throw reason;
          }
        } finally {
          session.signal.removeEventListener('abort', detach);
          session.dispose();
          activeConnection.signal.removeEventListener('abort', onConnectionLost);
          process.removeListener('SIGINT', onInterrupt);
        }
      } else if (importing) {
        await this.importConfigAsync(activeConnection, catalog, flags.import!, {
          session: controlSession,
          jsonFlag,
        });
      } else {
        const entry = Object.hasOwn(catalog, action!) ? catalog[action!] : undefined;
        await runActionAsync({
          action: action!,
          params: entry ? buildHostActionParams(action!, entry, argv.slice(1).map(String)) : {},
          outputPath: flags.output,
        });
      }
    } finally {
      connection?.close();
    }
  }

  private async importConfigAsync(
    connection: HostActionConnection,
    catalog: HostActionCatalog,
    filePath: string,
    { session, jsonFlag }: { session: ControlSession; jsonFlag: boolean }
  ): Promise<void> {
    const spinner = jsonFlag ? undefined : ora(`Validating ${path.basename(filePath)}`).start();
    const startedAt = Date.now();
    let stepStartedAt = startedAt;
    let config: PreparedControlConfig | undefined;
    let results: ControlConfigResult[];
    try {
      config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
      if (spinner) {
        spinner.succeed(`Validated ${formatActionCount(config.actions.length)}`);
        this.printSessionHeader(session);
        Log.log(chalk.bold(path.basename(config.path)));
        Log.gray(config.path);
        for (const { plan } of config.actions) {
          if (plan.localFile) {
            Log.gray(`  Read: ${plan.localFile.path}`);
          }
          if (plan.outputPath) {
            Log.gray(`  Output: ${plan.outputPath}`);
          }
        }
        if (config.actions.some(({ plan }) => plan.outputPath)) {
          Log.gray(
            'Explicit output files are overwritten; directory outputs use simulator filenames and fail if the file exists.'
          );
        }
        Log.newLine();
      }
      const prepared = config;
      results = await executeControlConfigAsync(connection, prepared, {
        onProgress: spinner
          ? progress => {
              const label = `[${progress.step}/${progress.total}] ${progress.action}`;
              if (progress.status === 'running') {
                stepStartedAt = Date.now();
                spinner.start(label);
              } else {
                spinner.succeed(`${label} ${chalk.dim(formatElapsed(stepStartedAt))}`);
                this.printConfigResult(progress.result);
              }
            }
          : undefined,
      });
    } catch (error) {
      if (error instanceof ControlConfigExecutionError && config) {
        spinner?.fail(
          `[${error.step}/${config.actions.length}] ${error.action} ${chalk.dim(formatElapsed(stepStartedAt))}`
        );
        if (jsonFlag) {
          printJsonOnlyOutput({
            id: session.id,
            session,
            config: config.path,
            results: serializeControlConfigResults(error.completed),
            error: { step: error.step, action: error.action, message: error.message },
          });
          process.exitCode = 1;
          return;
        }
        const skipped = config.actions.length - error.step;
        Log.newLine();
        Log.log(`${error.completed.length} completed · 1 failed · ${skipped} skipped`);
        for (const [index, { plan }] of config.actions.entries()) {
          if (index >= error.step) {
            Log.gray(`  [${index + 1}/${config.actions.length}] ${plan.action} skipped`);
          }
        }
      } else {
        spinner?.fail(config ? 'Import failed' : 'Validation failed. No actions were run.');
      }
      throw error;
    }
    if (jsonFlag) {
      printJsonOnlyOutput({
        id: session.id,
        session,
        config: config.path,
        results: serializeControlConfigResults(results),
      });
    } else {
      Log.newLine();
      Log.succeed(
        `Import complete · ${formatActionCount(results.length)} · ${formatElapsed(startedAt)}`
      );
    }
  }

  private printConfigResult(result: ControlConfigResult): void {
    if (result.file) {
      Log.log(`  Saved: ${result.file}`);
    } else if (result.output) {
      const output = parseControlActionOutput(result.output);
      const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      Log.log(
        text
          .split('\n')
          .map(line => `  ${line}`)
          .join('\n')
      );
    }
  }

  private printCatalog(catalog: HostActionCatalog, jsonFlag: boolean): void {
    if (jsonFlag) {
      printJsonOnlyOutput(catalog);
      return;
    }
    const names = Object.keys(catalog).sort();
    const width = Math.max(0, ...names.map(name => name.length)) + 3;
    const columns = Math.max(1, Math.min(3, Math.floor((process.stdout.columns || 80) / width)));
    const rows = Math.ceil(names.length / columns);
    for (let row = 0; row < rows; row++) {
      const cells = Array.from({ length: columns }, (_, column) =>
        (names[row + column * rows] ?? '').padEnd(width)
      );
      Log.log(cells.join('').trimEnd());
    }
    Log.newLine();
    Log.log('For action usage: eas simulator:control <action> --help');
  }

  private printActionHelp(action: string, entry: HostActionCatalogEntry, jsonFlag: boolean): void {
    if (jsonFlag) {
      printJsonOnlyOutput({ ...entry, action });
      return;
    }
    Log.newLine();
    Log.log(`  ${chalk.bold(action)}`);
    if (entry.description) {
      Log.log(`  ${entry.description}`);
    }
    Log.newLine();
    Log.log(`  ${chalk.bold('USAGE')}`);
    Log.log(`    eas simulator:control ${formatHostActionUsage(action, entry)}`);
    const outputFlag = entry.output === 'base64' ? '--output <path>' : '[--output <path>]';
    Log.log(`      ${entry.output ? `${outputFlag} ` : ''}[--id <session-id>] [--json]`);
    Log.newLine();
    Log.log(`  ${chalk.bold('OPTIONS')}`);
    Log.log(`    --id <session-id>  Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`);
    Log.log('    --json             Print the action schema as JSON. Implies --non-interactive.');
    if (entry.output) {
      Log.log(
        entry.output === 'base64'
          ? '    --output <path>    Required local filename for the returned file.'
          : '    --output <path>    Local filename or existing directory.'
      );
      if (entry.output === 'path') {
        Log.log('                       Omit to save with the generated filename.');
      }
      Log.newLine();
      Log.log(
        '  Action arguments refer to the simulator host. Use --output for the local filename.'
      );
    }
    Log.newLine();
  }

  private printSessionHeader(session: ControlSession): void {
    const clean = (value: string): string =>
      sanitizeTerminalText(
        stripVTControlCharacters(value).replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      );
    const runtime = clean(session.device.runtime ?? '')
      .replace(/^([A-Za-z]+)-/, '$1 ')
      .replaceAll('-', '.');
    Log.newLine();
    Log.log(chalk.bold('Simulator controls'));
    Log.log(
      formatFields([
        { label: 'Session', value: truncate(clean(session.name ?? '') || 'Unnamed session', 80) },
        { label: 'Project', value: clean(session.project) },
        {
          label: 'Device',
          value: [truncate(clean(session.device.name ?? '') || 'Unavailable', 80), runtime]
            .filter(Boolean)
            .join(' · '),
        },
        { label: 'State', value: session.status.toLowerCase().replaceAll('_', ' ') },
        { label: 'Session ID', value: clean(session.id) },
        { label: 'Device ID', value: clean(session.device.udid) },
      ])
    );
    Log.newLine();
  }

  private async runActionAsync(
    connection: HostActionConnection,
    catalog: HostActionCatalog,
    selection: ControlAction,
    {
      session,
      jsonFlag,
      interactive,
    }: { session: ControlSession; jsonFlag: boolean; interactive: boolean }
  ): Promise<void> {
    const { action } = selection;
    const plan = await prepareControlActionAsync(catalog, selection);
    const startedAt = Date.now();
    const spinner = ora(
      interactive ? `Running ${action}` : `Running ${action} on simulator session ${session.id}`
    ).start();
    let output: string;
    let savedFile: string | null;
    try {
      ({ output, file: savedFile } = await executeControlActionAsync(connection, plan));
      spinner.succeed(
        interactive
          ? `${action} complete · ${formatElapsed(startedAt)}`
          : `Ran ${action} on simulator session ${session.id}`
      );
    } catch (err) {
      spinner.fail(
        interactive
          ? `${action} failed`
          : `Failed to run ${action} on simulator session ${session.id}`
      );
      throw err;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: session.id,
        session,
        action,
        output: parseControlActionOutput(output),
        file: savedFile,
      });
      return;
    }
    if (interactive && plan.localFile?.path) {
      Log.gray(`Source: ${plan.localFile.path}`);
    }
    if (savedFile) {
      Log.log(`Saved ${savedFile}`);
    } else if (output) {
      const parsed = parseControlActionOutput(output);
      Log.log(interactive && typeof parsed !== 'string' ? JSON.stringify(parsed, null, 2) : output);
    }
  }
}

function formatElapsed(startedAt: number): string {
  return formatMilliseconds(Date.now() - startedAt) || '<1s';
}

function formatActionCount(count: number): string {
  return `${count} action${count === 1 ? '' : 's'}`;
}

function assertControllableSession(
  session: Awaited<ReturnType<typeof DeviceRunSessionQuery.byIdAsync>>
): PreviewApiAccess {
  if (session.status !== DeviceRunSessionStatus.InProgress) {
    throw new Error(
      `Simulator session ${session.id} is ${session.status.toLowerCase()}. Simulator actions need a running session. Start one with \`eas simulator:start\`.`
    );
  }
  if (session.platform !== AppPlatform.Ios) {
    throw new Error(
      `Simulator control on ${session.platform.toLowerCase()} is not supported yet. Simulator actions are available only for iOS sessions.`
    );
  }
  const access = session.remoteConfig ? getPreviewApiAccess(session.remoteConfig) : null;
  if (!access) {
    throw new Error(
      `Simulator session ${session.id} does not expose a preview server with a token. Simulator actions use that server. Start a new session with \`eas simulator:start\`.`
    );
  }
  return access;
}
