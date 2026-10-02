import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import Log from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import SessionManager from '../../user/SessionManager';
import { getActorDisplayName } from '../../user/User';
import {
  isDeviceLoginFailure,
  resumeDeviceLoginAsync,
  startDeviceLoginAsync,
} from '../../user/deviceLogin';

export default class AccountLogin extends EasCommand {
  static override description = 'log in with your Expo account';
  static override aliases = ['login'];
  static override examples = [
    '<%= config.bin %> login --device',
    '<%= config.bin %> login --device --non-interactive',
    '<%= config.bin %> login --device --non-interactive --resume REQUEST_ID --match NUMBER_FROM_USER',
  ];

  static override flags = {
    device: Flags.boolean({
      description: 'Log in using a code in a browser on any device',
      exclusive: ['sso'],
    }),
    ...EASNonInteractiveFlag,
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
      flags: { sso, browser, device, 'non-interactive': nonInteractive, resume, match },
    } = await this.parse(AccountLogin);

    if (nonInteractive && !device) {
      throw new Error('Use eas login --device --non-interactive to log in without prompts.');
    }

    const {
      sessionManager,
      maybeLoggedIn: { actor },
    } = await this.getContextAsync(AccountLogin, { nonInteractive });

    if (sessionManager.getAccessToken()) {
      throw new Error(
        'EXPO_TOKEN is set in your environment, and is being used for all EAS authentication. Unset EXPO_TOKEN to log in with an Expo account.'
      );
    }

    if (actor && !resume) {
      Log.warn(`You are already logged in as ${chalk.bold(getActorDisplayName(actor))}.`);

      const shouldContinue =
        nonInteractive ||
        (await confirmAsync({
          message: 'Do you want to continue?',
        }));
      if (!shouldContinue) {
        Errors.error('Aborted', { exit: 1 });
      }
    }

    if (device) {
      await this.runDeviceLoginAsync(sessionManager, { nonInteractive, resume, match });
      return;
    }

    await sessionManager.showLoginPromptAsync({ sso, browser });
    Log.log('Logged in');
  }

  private async runDeviceLoginAsync(
    sessionManager: SessionManager,
    options: { nonInteractive: boolean; resume?: string; match?: string }
  ): Promise<void> {
    let result = options.resume
      ? await resumeDeviceLoginAsync(options.resume, sessionManager, options.match)
      : await startDeviceLoginAsync();
    if (options.nonInteractive) {
      if (isDeviceLoginFailure(result)) {
        throw new Error(
          `Device login failed (${result.status}). Start again with eas login --device.`
        );
      }
      if (result.status === 'authenticated') {
        Log.log(`Logged in as ${result.username}`);
        return;
      }
      const resumeCommand = `eas login --device --non-interactive --resume ${result.request_id}`;
      if (!options.resume) {
        Log.log(`Open ${result.verification_uri_complete}`);
        Log.log(`Code: ${result.user_code}`);
        Log.log(
          'Ask the user to approve the login and send you the number shown in their browser.'
        );
        Log.log(`After they reply, run: ${resumeCommand} --match NUMBER_FROM_USER`);
      } else if (result.status === 'matching_required') {
        Log.log('Ask the user for the number shown in their browser, then run:');
        Log.log(`${resumeCommand} --match NUMBER_FROM_USER`);
      } else {
        Log.log(`Approval pending. Retry after ${result.retry_after} seconds:`);
        Log.log(`${resumeCommand}${options.match ? ` --match ${options.match}` : ''}`);
      }
      return;
    }

    if ('verification_uri_complete' in result) {
      Log.log(`Open ${result.verification_uri_complete}`);
      Log.log(`Code: ${result.user_code}`);
      Log.log(
        `Hint: if you need to leave, resume with eas login --device --resume ${result.request_id}`
      );
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
