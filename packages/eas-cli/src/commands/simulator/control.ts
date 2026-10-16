import { Args, Flags } from '@oclif/core';

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
  prepareControlActionAsync,
} from '../../simulator/controlActions';
import {
  ControlConfigExecutionError,
  ControlConfigResult,
  executeControlConfigAsync,
  prepareControlConfigAsync,
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
  HostActionConnection,
  buildHostActionParams,
  connectHostActionsAsync,
  fetchHostActionCatalogAsync,
  formatHostActionUsage,
} from '../../simulator/hostActions';
import { PreviewApiAccess, getPreviewApiAccess } from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorControl extends EasCommand {
  static override aliases = ['sim:control'];
  static override description =
    '[EXPERIMENTAL] control a remote iOS simulator session on EAS. Run without an action for an interactive menu, or with --list to see supported actions.';
  static override strict = false;

  static override examples = [
    '$ eas simulator:control',
    '$ eas simulator:control --list',
    '$ eas simulator:control --import ./simulator-control.json',
    '$ eas simulator:control hardwareKeyboard.set off',
    '$ eas simulator:control permissions.set grant camera com.example.app',
    '$ eas simulator:control app.install ./MyApp.ipa',
    '$ eas simulator:control screenshot.capture --output ./screenshot.png',
  ];

  static override args = {
    action: Args.string({
      description:
        'Action to run, followed by its values in order or as name=value. Run with --list to see the actions.',
    }),
  };

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    list: Flags.boolean({
      description: 'List the actions the session supports.',
    }),
    output: Flags.string({
      description: 'Where to save the file that an action returns, such as a screenshot.',
    }),
    import: Flags.string({
      description:
        'Run a version 1 JSON configuration with an actions array. Validate all steps first, then run in order until a step fails. File/output paths are relative to the configuration file.',
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
    const action = flags.list ? undefined : args.action;
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
    const sessionId = flags.id || process.env[EAS_SIMULATOR_SESSION_ID];
    if (!sessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const spinner = ora(`Connecting to simulator session ${sessionId}`).start();
    let connection: HostActionConnection | undefined;
    try {
      let catalog: HostActionCatalog;
      try {
        const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, sessionId);
        connection = await connectHostActionsAsync(assertControllableSession(session));
        catalog = await fetchHostActionCatalogAsync(connection);
        spinner.succeed(`Connected to simulator session ${sessionId}`);
      } catch (err) {
        spinner.fail(`Failed to connect to simulator session ${sessionId}`);
        throw err;
      }
      if (flags.list) {
        this.printCatalog(catalog, jsonFlag);
        return;
      }
      const activeConnection = connection;
      const runActionAsync = async (selection: ControlAction): Promise<void> => {
        await this.runActionAsync(activeConnection, catalog, selection, { sessionId, jsonFlag });
      };
      const importConfigAsync = async (filePath: string): Promise<void> => {
        await this.importConfigAsync(activeConnection, catalog, filePath, { sessionId, jsonFlag });
      };
      if (interactive) {
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
            importConfigAsync,
          });
        } catch (error) {
          const reason: unknown = session.signal.aborted ? session.signal.reason : error;
          if (reason instanceof ControlPromptCancelledError) {
            process.exitCode = 130;
          } else if (reason instanceof ControlSessionEndedError) {
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
        await importConfigAsync(flags.import!);
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
    { sessionId, jsonFlag }: { sessionId: string; jsonFlag: boolean }
  ): Promise<void> {
    const config = await prepareControlConfigAsync(catalog, filePath, connection.udid);
    const spinner = ora(`Importing configuration on simulator session ${sessionId}`).start();
    let results: ControlConfigResult[];
    try {
      results = await executeControlConfigAsync(connection, config);
      spinner.succeed(`Ran ${results.length} actions on simulator session ${sessionId}`);
    } catch (error) {
      spinner.fail(`Failed to import configuration on simulator session ${sessionId}`);
      if (error instanceof ControlConfigExecutionError) {
        if (jsonFlag) {
          printJsonOnlyOutput({
            id: sessionId,
            config: config.path,
            results: configResultsJson(error.completed),
            error: { step: error.step, action: error.action, message: error.message },
          });
          process.exitCode = 1;
          return;
        }
        this.printConfigResults(error.completed);
      }
      throw error;
    }
    if (jsonFlag) {
      printJsonOnlyOutput({
        id: sessionId,
        config: config.path,
        results: configResultsJson(results),
      });
    } else {
      this.printConfigResults(results);
    }
  }

  private printConfigResults(results: readonly ControlConfigResult[]): void {
    for (const [index, result] of results.entries()) {
      const detail = result.file ? `saved ${result.file}` : result.output || 'done';
      Log.log(`${index + 1}. ${result.action}: ${detail}`);
    }
  }

  private printCatalog(catalog: HostActionCatalog, jsonFlag: boolean): void {
    if (jsonFlag) {
      printJsonOnlyOutput(catalog);
      return;
    }
    for (const [name, entry] of Object.entries(catalog)) {
      Log.log(formatHostActionUsage(name, entry));
      if (entry.description) {
        Log.log(`    ${entry.description}`);
      }
    }
  }

  private async runActionAsync(
    connection: HostActionConnection,
    catalog: HostActionCatalog,
    selection: ControlAction,
    { sessionId, jsonFlag }: { sessionId: string; jsonFlag: boolean }
  ): Promise<void> {
    const { action } = selection;
    const plan = await prepareControlActionAsync(catalog, selection);
    const spinner = ora(`Running ${action} on simulator session ${sessionId}`).start();
    let output: string;
    let savedFile: string | null;
    try {
      ({ output, file: savedFile } = await executeControlActionAsync(connection, plan));
      spinner.succeed(`Ran ${action} on simulator session ${sessionId}`);
    } catch (err) {
      spinner.fail(`Failed to run ${action} on simulator session ${sessionId}`);
      throw err;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: sessionId,
        action,
        output: parseJsonOutput(output),
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

function configResultsJson(
  results: readonly ControlConfigResult[]
): { action: string; output: unknown; file: string | null }[] {
  return results.map(result => ({ ...result, output: parseJsonOutput(result.output) }));
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

function parseJsonOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}
