import { Args, Flags } from '@oclif/core';
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
    '[EXPERIMENTAL] run a serve-sim action on a remote iOS simulator session on EAS. Run without an action to list the actions the session supports. To save a screenshot locally, run `eas simulator:control screenshot.capture --output ./screenshot.png`.';
  static override strict = false;

  static override examples = [
    '$ eas simulator:control',
    '$ eas simulator:control --id <session-id>',
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
        'Action to run, followed by its values in order or as name=value. Omit to list the actions. Put -- before values that start with --.',
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
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }
    if (flags.id === '') {
      throw new Error('--id needs a simulator session ID.');
    }
    const action = flags.list ? undefined : args.action;

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
      await this.runActionAsync(connection, catalog, {
        sessionId,
        action,
        values: argv.slice(1).map(String),
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
    const rows = Object.entries(catalog).map(([name, entry]) => {
      const usage = formatHostActionUsage(name, entry);
      const output =
        entry.output === 'base64' ? '--output <local-path>' : '[--output <local-path>]';
      return {
        usage: entry.output ? `${usage} ${output}` : usage,
        description: entry.output
          ? `${entry.description ?? ''} Use --output for the local filename.`.trim()
          : entry.description,
      };
    });
    const width = Math.max(0, ...rows.map(row => row.usage.length));
    for (const { usage, description } of rows) {
      Log.log(description ? `${usage.padEnd(width)}  ${description}` : usage);
    }
  }

  private async runActionAsync(
    connection: HostActionConnection,
    catalog: HostActionCatalog,
    {
      sessionId,
      action,
      values,
      outputPath,
      jsonFlag,
    }: {
      sessionId: string;
      action: string;
      values: string[];
      outputPath: string | undefined;
      jsonFlag: boolean;
    }
  ): Promise<void> {
    const entry = Object.hasOwn(catalog, action) ? catalog[action] : undefined;
    if (!entry) {
      throw new Error(
        `Unknown simulator action "${action}". Run \`eas simulator:control --list\` to see the actions.`
      );
    }
    const params = buildHostActionParams(action, entry, values);
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
