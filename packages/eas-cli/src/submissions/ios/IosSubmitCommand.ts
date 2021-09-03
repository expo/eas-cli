import { IosSubmitProfile } from '@expo/eas-json';
import { Result, result } from '@expo/results';
import chalk from 'chalk';
import getenv from 'getenv';
import wrapAnsi from 'wrap-ansi';

import { AppPlatform, SubmissionFragment } from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';
import UserSettings from '../../user/UserSettings';
import { ArchiveSource } from '../ArchiveSource';
import { resolveArchiveSource } from '../commons';
import { SubmissionContext, SubmitArchiveFlags } from '../types';
import { ensureAppStoreConnectAppExistsAsync } from './AppProduce';
import {
  AppSpecificPasswordSource,
  AppSpecificPasswordSourceType,
} from './AppSpecificPasswordSource';
import IosSubmitter, { IosSubmissionOptions } from './IosSubmitter';

export default class IosSubmitCommand {
  static createContext({
    archiveFlags,
    profile,
    projectDir,
    projectId,
  }: {
    archiveFlags: SubmitArchiveFlags;
    profile: IosSubmitProfile;
    projectDir: string;
    projectId: string;
  }): SubmissionContext<AppPlatform.Ios> {
    return {
      archiveFlags,
      platform: AppPlatform.Ios,
      profile,
      projectDir,
      projectId,
    };
  }

  constructor(private ctx: SubmissionContext<AppPlatform.Ios>) {}

  async runAsync(): Promise<SubmissionFragment> {
    Log.addNewLineIfNone();
    const options = await this.resolveSubmissionOptionsAsync();
    const submitter = new IosSubmitter(this.ctx, options);
    return await submitter.submitAsync();
  }

  private async resolveSubmissionOptionsAsync(): Promise<IosSubmissionOptions> {
    const archiveSource = this.resolveArchiveSource();
    const appSpecificPasswordSource = this.resolveAppSpecificPasswordSource();

    const errored = [archiveSource, appSpecificPasswordSource].filter(r => !r.ok);
    if (errored.length > 0) {
      const message = errored.map(err => err.reason?.message).join('\n');
      Log.error(message);
      throw new Error('Failed to submit the app');
    }

    const { appleIdUsername, ascAppIdentifier } = await this.getAppStoreInfoAsync();

    return {
      projectId: this.ctx.projectId,
      appleIdUsername,
      ascAppIdentifier,
      archiveSource: archiveSource.enforceValue(),
      appSpecificPasswordSource: appSpecificPasswordSource.enforceValue(),
    };
  }

  private resolveAppSpecificPasswordSource(): Result<AppSpecificPasswordSource> {
    const envAppSpecificPassword = getenv.string('EXPO_APPLE_APP_SPECIFIC_PASSWORD', '');

    if (envAppSpecificPassword) {
      return result({
        sourceType: AppSpecificPasswordSourceType.userDefined,
        appSpecificPassword: envAppSpecificPassword,
      });
    }

    return result({
      sourceType: AppSpecificPasswordSourceType.prompt,
    });
  }

  private resolveArchiveSource(): Result<ArchiveSource> {
    return result(resolveArchiveSource(this.ctx, AppPlatform.Ios));
  }

  /**
   * Returns App Store related information required for build submission
   * It is:
   * - User Apple ID
   * - App Store Connect app ID (appAppleId)
   */
  private async getAppStoreInfoAsync(): Promise<{
    appleIdUsername: string;
    ascAppIdentifier: string;
  }> {
    const { ascAppId } = this.ctx.profile;

    if (ascAppId) {
      return {
        appleIdUsername: await this.getAppleIdAsync(),
        ascAppIdentifier: ascAppId,
      };
    }

    Log.log(
      wrapAnsi(
        chalk.italic(
          'Ensuring your app exists on App Store Connect. ' +
            `This step can be skipped by providing the --asc-app-id param. ${learnMore(
              'https://expo.fyi/asc-app-id'
            )}`
        ),
        process.stdout.columns || 80
      )
    );
    Log.addNewLineIfNone();
    return await ensureAppStoreConnectAppExistsAsync(this.ctx);
  }

  /**
   * This is going to be used only when `produce` is not being run,
   * and we don't need to call full credentials.authenticateAsync()
   * and we just need apple ID
   */
  private async getAppleIdAsync(): Promise<string> {
    const { appleId } = this.ctx.profile;
    const envAppleId = getenv.string('EXPO_APPLE_ID', '');

    if (appleId) {
      return appleId;
    } else if (envAppleId) {
      return envAppleId;
    }

    // Get the email address that was last used and set it as
    // the default value for quicker authentication.
    const lastAppleId = await UserSettings.getAsync('appleId', null);

    const { appleId: promptAppleId } = await promptAsync({
      type: 'text',
      name: 'appleId',
      message: `Enter your Apple ID:`,
      validate: (val: string) => !!val,
      initial: lastAppleId ?? undefined,
    });

    return promptAppleId;
  }
}
