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
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  formatHostActionUsage,
  hostActionPrintsJson,
  resolveHostActionRequest,
  runHostActionAsync,
} from '../../simulator/hostActions';
import { getPreviewApiAccess } from '../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorControl extends EasCommand {
  static override aliases = ['sim:control'];
  static override description = `[EXPERIMENTAL] change settings and trigger device actions on a remote iOS simulator session on EAS

Actions:
${formatHostActionUsage()}`;
  static override strict = false;

  static override examples = [
    '$ eas simulator:control hardware-keyboard off',
    '$ eas simulator:control appearance dark',
    '$ eas simulator:control location 37.3349 -122.009',
    '$ eas simulator:control permissions grant camera com.example.app',
    '$ eas simulator:control settings --json',
  ];

  static override args = {
    name: Args.string({
      description: 'Action to run, followed by its values. See the list of actions above.',
      required: true,
    }),
  };

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
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

    const request = resolveHostActionRequest(args.name, argv.slice(1).map(String));

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

    const spinner = ora(`Running ${args.name} on simulator session ${sessionId}`).start();
    let output: string;
    try {
      const session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, sessionId);
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
      const result = await runHostActionAsync(access, request);
      if (result.exitCode !== 0) {
        const detail = (result.stderr || result.stdout).trim() || `exit code ${result.exitCode}`;
        throw new Error(`The simulator could not run ${args.name}: ${detail}`);
      }
      output = result.stdout.trim();
      spinner.succeed(`Ran ${args.name} on simulator session ${session.id}`);
    } catch (err) {
      spinner.fail(`Failed to run ${args.name} on simulator session ${sessionId}`);
      throw err;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: sessionId,
        action: args.name,
        output: hostActionPrintsJson(args.name) ? parseJsonOutput(output) : output,
      });
      return;
    }
    if (output) {
      Log.log(output);
    }
  }
}

function parseJsonOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}
