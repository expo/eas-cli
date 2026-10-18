import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import path from 'path';

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
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  HostActionCatalog,
  HostActionCatalogEntry,
  HostActionConnection,
  assertHostActionOutputAsync,
  buildHostActionParams,
  connectHostActionsAsync,
  fetchHostActionCatalogAsync,
  formatHostActionUsage,
  saveHostActionOutputAsync,
  uploadFileAsync,
} from '../../simulator/hostActions';
import { PreviewApiAccess, getPreviewApiAccess } from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorControl extends EasCommand {
  static override aliases = ['sim:control'];
  static override description =
    '[EXPERIMENTAL] run a serve-sim action on a remote iOS simulator session on EAS. Run without an action to list the actions the session supports. To save a screenshot locally, run `eas simulator:control screenshot.capture --output ./screenshot.png`';
  static override strict = false;

  static override examples = [
    '$ eas simulator:control',
    '$ eas simulator:control --id <session-id>',
    '$ eas simulator:control screenshot.capture --help',
    '$ eas simulator:control clipboard.write -- --some-text',
    {
      description:
        'Write hello using the named text parameter (shell quotes do not change parsing):',
      command: "$ eas simulator:control clipboard.write 'text=hello'",
    },
    {
      description: 'Write the literal text=hello using --:',
      command: "$ eas simulator:control clipboard.write -- 'text=hello'",
    },
    '$ eas simulator:control hardwareKeyboard.set off',
    '$ eas simulator:control permissions.set grant camera com.example.app',
    '$ eas simulator:control app.install ./MyApp.ipa',
    '$ eas simulator:control screenshot.capture --output ./screenshot.png',
    '$ eas simulator:control screenshot.capture --output ./screenshot.png --id <session-id>',
  ];

  static override args = {
    action: Args.string({
      description:
        'Action to run, followed by its values in order or as name=value. Omit to list the actions. Values after -- are positional literals, including text that starts with -- or name=. Shell quotes alone do not disable name=value parsing.',
    }),
  };

  static override flags = {
    help: Flags.boolean({
      char: 'h',
      description: 'Show command help, or usage for the selected action from the session.',
    }),
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    list: Flags.boolean({
      description: 'List the actions the session supports.',
    }),
    output: Flags.string({
      description:
        'Local path to save a returned file. For screenshots, --output ./screenshot.png sets the local filename; omit it to save with a generated filename in the current directory.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { args, argv, flags } = await this.parse(SimulatorControl);
    let literalFrom = argv.length - 1;
    for (let index = 0; index < this.argv.length; index++) {
      const value = this.argv[index];
      if (value === '--') {
        literalFrom = argv.length - 1 - (this.argv.length - index - 1);
        break;
      }
      // A standalone -- consumed as a flag value is not an argument separator.
      const flag = value.startsWith('--')
        ? SimulatorControl.flags[value.slice(2) as keyof typeof SimulatorControl.flags]
        : undefined;
      if (flag?.type === 'option') {
        index++;
      }
    }
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }
    if (flags.id === '') {
      throw new Error('--id needs a simulator session ID.');
    }
    const action = flags.list && !flags.help ? undefined : args.action;

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
      try {
        const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, sessionId);
        connection = await connectHostActionsAsync(assertControllableSession(session));
        catalog = await fetchHostActionCatalogAsync(connection);
        spinner.succeed(`Connected to simulator session ${sessionId}`);
      } catch (err) {
        spinner.fail(`Failed to connect to simulator session ${sessionId}`);
        throw err;
      }
      if (!action) {
        this.printCatalog(catalog, jsonFlag);
        return;
      }
      const entry = Object.hasOwn(catalog, action) ? catalog[action] : undefined;
      if (!entry) {
        throw new Error(
          `Unknown simulator action "${action}". Run \`eas simulator:control\` to see the actions.`
        );
      }
      if (flags.help) {
        this.printActionHelp(action, entry, jsonFlag);
        return;
      }
      await this.runActionAsync(connection, entry, {
        sessionId,
        action,
        values: argv.slice(1).map(String),
        literalFrom,
        outputPath: flags.output,
        jsonFlag,
      });
    } finally {
      connection?.close();
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
    Log.log('  Values after -- are positional literals.');
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

  private async runActionAsync(
    connection: HostActionConnection,
    entry: HostActionCatalogEntry,
    {
      sessionId,
      action,
      values,
      literalFrom,
      outputPath,
      jsonFlag,
    }: {
      sessionId: string;
      action: string;
      values: string[];
      literalFrom: number;
      outputPath: string | undefined;
      jsonFlag: boolean;
    }
  ): Promise<void> {
    const params = buildHostActionParams(action, entry, values, literalFrom);
    await assertHostActionOutputAsync(action, entry, outputPath);
    const localFile = await findLocalUploadAsync(entry, params);

    const spinner = ora(`Running ${action} on simulator session ${sessionId}`).start();
    let uploadId: string | undefined;
    let succeeded = false;
    let output: string;
    let savedFile: string | null;
    try {
      if (localFile) {
        spinner.text = `Uploading ${localFile.path}`;
        const upload = await uploadFileAsync(connection, localFile.path);
        uploadId = upload.uploadId;
        params[localFile.param] = entry.uploadAs === 'id' ? upload.uploadId : upload.path;
        spinner.text = `Running ${action} on simulator session ${sessionId}`;
      }
      const result = await connection.requestAsync(action, params);
      if (result.exitCode !== 0) {
        const detail = (result.stderr || result.stdout).trim() || `exit code ${result.exitCode}`;
        throw new Error(`The simulator could not run ${action}: ${detail}`);
      }
      succeeded = true;
      savedFile = await saveHostActionOutputAsync(connection, entry, result.stdout, outputPath);
      output = savedFile ? '' : result.stdout.trim();
      spinner.succeed(`Ran ${action} on simulator session ${sessionId}`);
    } catch (err) {
      spinner.fail(`Failed to run ${action} on simulator session ${sessionId}`);
      throw err;
    } finally {
      if (uploadId && (!entry.keepUpload || !succeeded)) {
        await connection.requestAsync('upload.remove', { uploadId }).catch(() => {});
      }
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

async function findLocalUploadAsync(
  { upload: param, uploadWhen = {} }: HostActionCatalogEntry,
  params: Record<string, unknown>
): Promise<{ param: string; path: string } | null> {
  const value = param ? params[param] : undefined;
  const applies = Object.entries(uploadWhen).every(([name, expected]) => params[name] === expected);
  if (!param || typeof value !== 'string' || !applies) {
    return null;
  }
  const stat = await fs.stat(value).catch(() => null);
  if (stat?.isDirectory()) {
    throw new Error(`${value} is a folder. Pass the path of a file.`);
  }
  if (!stat && !path.isAbsolute(value)) {
    throw new Error(
      `${value} does not exist on this computer. Pass the path of a local file, or an absolute path on the simulator host.`
    );
  }
  return stat ? { param, path: value } : null;
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
      `Simulator session ${session.id} runs on ${session.platform.toLowerCase()}. Simulator actions are available only for iOS sessions.`
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
