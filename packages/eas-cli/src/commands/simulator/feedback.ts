import spawnAsync from '@expo/spawn-async';
import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { isNonInteractiveByDefault } from '../../commandUtils/flags';
import { EAS_SIMULATOR_SESSION_ID, SIMULATOR_DOTENV_FILE_NAME } from '../../simulator/env';

export default class SimulatorFeedback extends EasCommand {
  static override hidden = true;
  static override aliases = ['sim:feedback'];
  static override description = '[EXPERIMENTAL] send feedback about EAS Simulator to the Expo team';

  static override args = {
    message: Args.string({
      description: 'Feedback message. Omit it to be prompted in an interactive terminal.',
    }),
  };

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID to attach to the feedback. Defaults to the session in ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    subject: Flags.string({
      description: 'Simulator command or feature the feedback is about, e.g. "simulator:exec".',
    }),
    'non-interactive': Flags.boolean({
      description: 'Run the command in non-interactive mode.',
      default: () => Promise.resolve(isNonInteractiveByDefault()),
      noCacheDefault: true,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  private isRunningSubprocess = false;

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(SimulatorFeedback);
    const nonInteractive = flags['non-interactive'];

    const message = args.message?.trim();
    if (nonInteractive && !message) {
      throw new Error(
        'Feedback message is required in non-interactive mode. Run `eas simulator:feedback "<your feedback>"` to pass it as an argument.'
      );
    }

    const { projectDir } = await this.getContextAsync(SimulatorFeedback, {
      nonInteractive,
    });

    // submit-expo-feedback resolves the active session itself, from EAS_SIMULATOR_SESSION_ID
    // or the simulator dotenv file in its working directory; --id overrides it through the
    // environment. It also prompts for the message when one is not passed.
    this.isRunningSubprocess = true;
    await spawnAsync(
      'npx',
      [
        '--yes',
        'submit-expo-feedback@latest',
        '--category',
        'simulator',
        ...(flags.subject ? ['--subject', flags.subject] : []),
        ...(message ? [message] : []),
      ],
      {
        cwd: projectDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          ...(flags.id ? { [EAS_SIMULATOR_SESSION_ID]: flags.id } : {}),
        },
      }
    );
  }

  protected override catch(err: Error): Promise<any> {
    // Propagate wrapped command from spawnAsync rejection
    if (this.isRunningSubprocess) {
      process.exitCode = process.exitCode ?? (err as any).status ?? 1;
      return Promise.resolve();
    }
    return super.catch(err);
  }
}
