import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
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
    const interactive = !flags.list && !action;
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
          await runControlMenuAsync({ catalog, signal: session.signal, runActionAsync });
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
