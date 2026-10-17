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
  prepareControlActionAsync,
} from '../../simulator/controlActions';
import {
  ControlConfigExecutionError,
  ControlConfigResult,
  PreparedControlConfig,
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
import { sanitizeTerminalText } from '../../utils/terminalText';
import { formatMilliseconds } from '../../utils/timer';

type ControlSession = {
  id: string;
  name: string | null;
  project: string;
  status: string;
  device: HostActionDevice;
};

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
            interactive || (jsonFlag && !flags.list)
              ? await fetchHostActionDeviceAsync(access, connection.udid)
              : { udid: connection.udid },
        };
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
          sessionId,
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
    { sessionId, jsonFlag }: { sessionId: string; jsonFlag: boolean }
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
        Log.newLine();
        Log.log(chalk.bold(path.basename(config.path)));
        Log.gray(`Session ${sessionId} · ${formatActionCount(config.actions.length)}`);
        Log.gray(config.path);
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
                const source = prepared.actions[progress.step - 1].plan.localFile;
                if (source) {
                  Log.gray(`  Source: ${source.path}`);
                }
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
            id: sessionId,
            config: config.path,
            results: configResultsJson(error.completed),
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
        id: sessionId,
        config: config.path,
        results: configResultsJson(results),
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
      const output = parseJsonOutput(result.output);
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
    for (const [name, entry] of Object.entries(catalog)) {
      Log.log(formatHostActionUsage(name, entry));
      if (entry.description) {
        Log.log(`    ${entry.description}`);
      }
    }
  }

  private printSessionHeader(session: ControlSession): void {
    const runtime = session.device.runtime?.replace(/^([A-Za-z]+)-/, '$1 ').replaceAll('-', '.');
    Log.newLine();
    Log.log(chalk.bold('Simulator controls'));
    Log.log(
      formatFields(
        [
          { label: 'Session', value: session.name || 'Unnamed session' },
          { label: 'Project', value: session.project },
          {
            label: 'Device',
            value: [session.device.name || 'iOS Simulator', runtime].filter(Boolean).join(' · '),
          },
          { label: 'State', value: session.status.toLowerCase().replaceAll('_', ' ') },
          { label: 'Session ID', value: session.id },
          { label: 'Device ID', value: session.device.udid },
        ].map(field => ({
          ...field,
          value: sanitizeTerminalText(stripVTControlCharacters(field.value)),
        }))
      )
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
          ? `${action} complete · ${formatMilliseconds(Date.now() - startedAt) || '<1s'}`
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
        output: parseJsonOutput(output),
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
      const parsed = parseJsonOutput(output);
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
