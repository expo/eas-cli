import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import Log from '../../log';
import { ora } from '../../ora';
import {
  assertControlKeepAliveSupported,
  borrowControlConnectionAsync,
  createControlConnectionIdentityAsync,
  openControlConnectionAsync,
} from '../../simulator/controlConnection';
import { ControlSession } from '../../simulator/controlConnectionProtocol';
import { loadControlSessionAsync } from '../../simulator/controlSession';
import {
  ControlAction,
  executeControlActionAsync,
  parseControlActionOutput,
  prepareControlActionAsync,
} from '../../simulator/controlActions';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  HostActionCatalog,
  HostActionCatalogEntry,
  HostActionConnection,
  buildHostActionParams,
  connectHostActionsAsync,
  fetchHostActionCatalogAsync,
  fetchHostActionDeviceAsync,
  formatHostActionUsage,
} from '../../simulator/hostActions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import {
  getSimulatorCommandAliases,
  getSimulatorCommandHiddenAliases,
} from '../../simulator/commandAliases';
import { formatMilliseconds } from '../../utils/timer';

export default class SimulatorControl extends EasCommand {
  static override aliases = getSimulatorCommandAliases('control');
  static override hiddenAliases = getSimulatorCommandHiddenAliases('control');
  static override description = `[EXPERIMENTAL] control a remote iOS simulator session on EAS

Run without an action to list available actions. Use <action> --help for usage.

Use --keep-alive to reuse the connection across commands, or prepare it with simulator:control:connection open. Connections close after 120 seconds idle by default; use --idle-timeout to change the timeout in seconds.

To save a screenshot locally, run \`eas simulator:control screenshot.capture --output ./screenshot.png\`.

Existing output files are overwritten. When saving to a directory, an existing file with the generated name causes the action to fail.`;
  static override strict = false;

  static override examples = [
    '$ eas simulator:control',
    '$ eas simulator:control --id <session-id>',
    '$ eas simulator:control screenshot.capture --help',
    '$ eas simulator:control clipboard.write -- --some-text',
    '$ eas simulator:control hardwareKeyboard.set off',
    '$ eas simulator:control permissions.set grant camera com.example.app',
    '$ eas simulator:control app.install ./MyApp.ipa',
    '$ eas simulator:control screenshot.capture --output ./screenshot.png',
    '$ eas simulator:control screenshot.capture --output ./screenshot.png --id <session-id>',
  ];

  static override args = {
    action: Args.string({
      description:
        'Action name, followed by values or name=value pairs. Omit to list actions. Use -- before values starting with --.',
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
    'keep-alive': Flags.boolean({
      description:
        'Keep the control connection available for subsequent commands (macOS and Linux)',
    }),
    'idle-timeout': Flags.integer({
      min: 1,
      max: 86_400,
      description: 'Seconds of idle time before closing the kept-alive connection (default: 120)',
      dependsOn: ['keep-alive'],
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
    const idleTimeoutMs =
      flags['idle-timeout'] !== undefined ? flags['idle-timeout'] * 1_000 : undefined;
    if (flags['keep-alive']) {
      assertControlKeepAliveSupported();
    }
    const action = flags.list && !flags.help ? undefined : args.action;
    if (!action && flags.output) {
      throw new Error('--output requires an action.');
    }

    const {
      projectDir,
      loggedIn: { graphqlClient, authenticationInfo },
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
        const identity = await createControlConnectionIdentityAsync(
          sessionId,
          projectDir,
          authenticationInfo
        );
        if (flags['keep-alive']) {
          await openControlConnectionAsync(
            identity,
            () => loadControlSessionAsync(graphqlClient, sessionId),
            idleTimeoutMs
          );
        }
        const borrowed = await borrowControlConnectionAsync(identity);
        if (flags['keep-alive'] && !borrowed) {
          throw new Error(
            'The control helper closed before it could be used. Open the connection again.'
          );
        }
        if (borrowed) {
          connection = borrowed.connection;
          catalog = borrowed.catalog;
          controlSession = borrowed.info.session;
          spinner.stop();
          if (flags['keep-alive'] && !action && !flags.list && !flags.help) {
            if (jsonFlag) {
              printJsonOnlyOutput({ connected: true, id: sessionId, connection: borrowed.info });
            } else {
              Log.succeed(
                `Control connection ready · idle timeout: ${formatMilliseconds(borrowed.info.idleTimeoutMs)}`
              );
            }
            return;
          }
        } else {
          const { access, session } = await loadControlSessionAsync(graphqlClient, sessionId);
          connection = await connectHostActionsAsync(access);
          catalog = await fetchHostActionCatalogAsync(connection);
          controlSession = {
            ...session,
            device:
              jsonFlag && Boolean(action) && !flags.list && !flags.help
                ? await fetchHostActionDeviceAsync(access, connection.udid)
                : { udid: connection.udid },
          };
          spinner.succeed(`Connected to simulator session ${sessionId}`);
        }
      } catch (err) {
        spinner.fail(`Failed to connect to simulator session ${sessionId}`);
        throw err;
      }
      if (!action) {
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
      const entry = Object.hasOwn(catalog, action) ? catalog[action] : undefined;
      await this.runActionAsync(
        connection,
        catalog,
        {
          action,
          params: entry ? buildHostActionParams(action, entry, argv.slice(1).map(String)) : {},
          outputPath: flags.output,
        },
        { session: controlSession, jsonFlag }
      );
    } finally {
      connection?.close();
    }
  }

  private printCatalog(catalog: HostActionCatalog, jsonFlag: boolean): void {
    if (jsonFlag) {
      printJsonOnlyOutput(
        Object.fromEntries(
          Object.entries(catalog).map(([name, entry]) => [name, withUploadPathHelp(entry)])
        )
      );
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
      printJsonOnlyOutput({ ...withUploadPathHelp(entry), action });
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
    const uploadHelp = uploadPathHelp(entry);
    if (uploadHelp) {
      Log.newLine();
      Log.log(`  ${uploadHelp}`);
    }
    Log.newLine();
  }

  private async runActionAsync(
    connection: HostActionConnection,
    catalog: HostActionCatalog,
    selection: ControlAction,
    { session, jsonFlag }: { session: ControlSession; jsonFlag: boolean }
  ): Promise<void> {
    const { action } = selection;
    const plan = await prepareControlActionAsync(catalog, selection);
    const spinner = ora(`Running ${action} on simulator session ${session.id}`).start();
    let output: string;
    let savedFile: string | null;
    try {
      ({ output, file: savedFile } = await executeControlActionAsync(connection, plan));
      spinner.succeed(`Ran ${action} on simulator session ${session.id}`);
    } catch (err) {
      spinner.fail(`Failed to run ${action} on simulator session ${session.id}`);
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
    if (savedFile) {
      Log.log(`Saved ${savedFile}`);
    } else if (output) {
      Log.log(output);
    }
  }
}

function uploadPathHelp(entry: HostActionCatalogEntry): string | undefined {
  if (!entry.upload) {
    return undefined;
  }
  return entry.uploadAs === 'id'
    ? 'This action requires a local file to upload. host: paths are not supported.'
    : 'File paths are local. Use host:/absolute/path for files on the simulator host.';
}

function withUploadPathHelp(entry: HostActionCatalogEntry): HostActionCatalogEntry {
  const help = uploadPathHelp(entry);
  return help
    ? { ...entry, description: [entry.description, help].filter(Boolean).join('\n\n') }
    : entry;
}
