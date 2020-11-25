import { Result, result } from '@expo/results';
import chalk from 'chalk';
import getenv from 'getenv';
import wordwrap from 'wordwrap';

import log from '../../log';
import { getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import UserSettings from '../../user/UserSettings';
import { ArchiveSource, ArchiveTypeSourceType } from '../archiveSource';
import { resolveArchiveFileSource } from '../commons';
import { IosSubmissionContext, IosSubmitCommandFlags, SubmissionPlatform } from '../types';
import { ensureAppStoreConnectAppExistsAsync } from './AppProduce';
import {
  AppSpecificPasswordSource,
  AppSpecificPasswordSourceType,
} from './AppSpecificPasswordSource';
import IosSubmitter, { IosSubmissionOptions } from './IosSubmitter';

class IosSubmitCommand {
  static createContext(
    projectDir: string,
    commandFlags: IosSubmitCommandFlags
  ): IosSubmissionContext {
    return {
      projectDir,
      commandFlags,
    };
  }

  constructor(private ctx: IosSubmissionContext) {}

  async runAsync(): Promise<void> {
    const projectId = await getProjectIdAsync(this.ctx.projectDir);
    log.addNewLineIfNone();

    const options = await this.resolveSubmissionOptionsAsync(projectId);
    const submitter = new IosSubmitter(this.ctx, options);
    await submitter.submitAsync();
  }

  private async resolveSubmissionOptionsAsync(projectId: string): Promise<IosSubmissionOptions> {
    const archiveSource = this.resolveArchiveSource(projectId);
    const appSpecificPasswordSource = this.resolveAppSpecificPasswordSource();

    const errored = [archiveSource, appSpecificPasswordSource].filter(r => !r.ok);
    if (errored.length > 0) {
      const message = errored.map(err => err.reason?.message).join('\n');
      log.error(message);
      throw new Error('Failed to submit the app');
    }

    const { appleId, ascAppId } = await this.getAppStoreInfoAsync();

    return {
      projectId,
      appleId,
      ascAppId,
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

  private resolveArchiveSource(projectId: string): Result<ArchiveSource> {
    return result({
      archiveFile: resolveArchiveFileSource(SubmissionPlatform.iOS, this.ctx, projectId),
      archiveType: { sourceType: ArchiveTypeSourceType.infer },
    });
  }

  /**
   * Returns App Store related information required for build submission
   * It is:
   * - User Apple ID
   * - App Store Connect app ID (appAppleId)
   */
  private async getAppStoreInfoAsync(): Promise<{
    appleId: string;
    ascAppId: string;
  }> {
    const { ascAppId } = this.ctx.commandFlags;

    if (ascAppId) {
      return {
        appleId: await this.getAppleIdAsync(),
        ascAppId,
      };
    }

    const wrap = wordwrap(process.stdout.columns || 80);
    log(
      wrap(
        chalk.italic(
          'Ensuring your app exists on App Store Connect. ' +
            'This step can be skipped by providing the --asc-app-id param. Learn more here: https://expo.fyi/asc-app-id'
        )
      )
    );
    return await ensureAppStoreConnectAppExistsAsync(this.ctx);
  }

  /**
   * This is going to be used only when `produce` is not being run,
   * and we don't need to call full credentials.authenticateAsync()
   * and we just need apple ID
   */
  private async getAppleIdAsync(): Promise<string> {
    const { appleId } = this.ctx.commandFlags;
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

export default IosSubmitCommand;
