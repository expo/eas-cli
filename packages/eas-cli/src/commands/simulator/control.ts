import { Args, Flags } from '@oclif/core';
import * as fs from 'fs-extra';

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
  HostActionConnection,
  assertHostActionOutput,
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
    '[EXPERIMENTAL] run a serve-sim action on a remote iOS simulator session on EAS. Run with --list to see the actions the session supports.';
  static override strict = false;

  static override examples = [
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
    if (!flags.list && !action) {
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
    let connection: HostActionConnection;
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

    try {
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
      connection.close();
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
    assertHostActionOutput(action, entry, outputPath);
    const uploadParam = entry.upload;
    const localFile = uploadParam ? params[uploadParam] : undefined;
    const localStat =
      typeof localFile === 'string' ? await fs.stat(localFile).catch(() => null) : null;
    if (localStat?.isDirectory()) {
      throw new Error(`${localFile} is a folder. Pass a file, for example an .ipa.`);
    }

    const spinner = ora(`Running ${action} on simulator session ${sessionId}`).start();
    let uploadId: string | undefined;
    let output: string;
    let savedFile: string | null;
    try {
      if (uploadParam && localStat && typeof localFile === 'string') {
        spinner.text = `Uploading ${localFile}`;
        const upload = await uploadFileAsync(connection, localFile);
        uploadId = upload.uploadId;
        params[uploadParam] = upload.path;
        spinner.text = `Running ${action} on simulator session ${sessionId}`;
      }
      const result = await connection.requestAsync(action, params);
      if (result.exitCode !== 0) {
        const detail = (result.stderr || result.stdout).trim() || `exit code ${result.exitCode}`;
        throw new Error(`The simulator could not run ${action}: ${detail}`);
      }
      savedFile = await saveHostActionOutputAsync(connection, entry, result.stdout, outputPath);
      output = savedFile ? '' : result.stdout.trim();
      spinner.succeed(`Ran ${action} on simulator session ${sessionId}`);
    } catch (err) {
      spinner.fail(`Failed to run ${action} on simulator session ${sessionId}`);
      throw err;
    } finally {
      if (uploadId && !entry.keepUpload) {
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
