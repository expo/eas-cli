import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import SessionManager from '../../user/SessionManager';
import { getActorDisplayName } from '../../user/User';
import {
  isDeviceLoginFailure,
  resumeDeviceLoginAsync,
  startDeviceLoginAsync,
} from '../../user/deviceLogin';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class AccountLogin extends EasCommand {
  static override description = 'log in with your Expo account';
  static override aliases = ['login'];
  static override examples = [
    '<%= config.bin %> login --device',
    '<%= config.bin %> login --device --json',
    '<%= config.bin %> login --device --json --resume REQUEST_ID --match NUMBER_FROM_USER',
  ];

  static override flags = {
    device: Flags.boolean({
      description: 'Log in using a code in a browser on any device',
      exclusive: ['sso'],
    }),
    json: Flags.boolean({
      description: 'Perform one device login step and output JSON without prompts or waiting',
      dependsOn: ['device'],
    }),
    resume: Flags.string({
      description: 'Resume a saved device login using its request ID (one command at a time)',
      dependsOn: ['device'],
    }),
    match: Flags.string({
      description: 'Submit the number the user sees in their browser',
      dependsOn: ['device', 'resume'],
    }),
    // can pass either --sso or -s
    sso: Flags.boolean({
      description: 'Log in with SSO',
      char: 's',
      default: false,
    }),
    browser: Flags.boolean({
      description: 'Log in with your browser (default; use --no-browser for CLI-based login)',
      char: 'b',
      default: true,
      allowNo: true,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.MaybeLoggedIn,
    ...this.ContextOptions.SessionManagment,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { sso, browser, device, json, resume, match },
    } = await this.parse(AccountLogin);

    if (json) {
      enableJsonOutput();
    }
    if (device && !json && !process.stdin.isTTY) {
      throw new Error('Use eas login --device --json to log in without a terminal.');
    }

    const {
      sessionManager,
      maybeLoggedIn: { actor },
    } = await this.getContextAsync(AccountLogin, { nonInteractive: false });

    if (sessionManager.getAccessToken()) {
      throw new Error(
        'EXPO_TOKEN is set in your environment, and is being used for all EAS authentication. Unset EXPO_TOKEN to log in with an Expo account.'
      );
    }

    if (actor && !resume) {
      Log.warn(`You are already logged in as ${chalk.bold(getActorDisplayName(actor))}.`);

      const shouldContinue =
        json ||
        (await confirmAsync({
          message: 'Do you want to continue?',
        }));
      if (!shouldContinue) {
        Errors.error('Aborted', { exit: 1 });
      }
    }

    if (device) {
      await this.runDeviceLoginAsync(sessionManager, { json, resume, match });
      return;
    }

    await sessionManager.showLoginPromptAsync({ sso, browser });
    Log.log('Logged in');
  }

  private async runDeviceLoginAsync(
    sessionManager: SessionManager,
    options: { json?: boolean; resume?: string; match?: string }
  ): Promise<void> {
    let result = options.resume
      ? await resumeDeviceLoginAsync(options.resume, sessionManager, options.match)
      : await startDeviceLoginAsync();
    if (options.json) {
      printJsonOnlyOutput(result);
      if (isDeviceLoginFailure(result)) {
        this.exit(1);
      }
      return;
    }

    if ('verification_uri_complete' in result) {
      Log.log(`Open ${result.verification_uri_complete}`);
      Log.log(`Code: ${result.user_code}`);
      Log.log(`To continue after exiting: eas login --device --resume ${result.request_id}`);
    }
    let match = options.match;
    while (result.status !== 'authenticated') {
      if (isDeviceLoginFailure(result)) {
        throw new Error(
          `Device login failed (${result.status}). Start again with eas login --device.`
        );
      }
      if (result.status === 'matching_required') {
        const answer = await promptAsync({
          type: 'select',
          name: 'match',
          message: 'Select the number shown in your browser',
          choices: result.match_options.map(value => ({ title: value, value })),
        });
        match = answer.match;
      }
      const delayMs = result.retry_after * 1000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      result = await resumeDeviceLoginAsync(result.request_id, sessionManager, match);
    }
    Log.log(`Logged in as ${result.username}`);
  }
}
