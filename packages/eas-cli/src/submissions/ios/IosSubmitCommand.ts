import { getConfig } from '@expo/config';
import { Result, result } from '@expo/results';
import chalk from 'chalk';
import * as uuid from 'uuid';
import wordwrap from 'wordwrap';

import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import UserSettings from '../../user/UserSettings';
import {
  ArchiveFileSource,
  ArchiveFileSourceType,
  ArchiveSource,
  ArchiveTypeSourceType,
} from '../archive-source';
import { IosSubmissionContext, IosSubmitCommandFlags, SubmissionPlatform } from '../types';
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
    const projectId = await this.getProjectIdAsync();
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

    // This is gonna be changed to use credentials.authenticateAsync()
    // when implementing produce
    const appleId = await this.getAppleIdAsync();
    const appAppleId = await this.getAppAppleIdAsync();

    return {
      projectId,
      appleId,
      appAppleId,
      archiveSource: archiveSource.enforceValue(),
      appSpecificPasswordSource: appSpecificPasswordSource.enforceValue(),
    };
  }

  // TODO: common with Android part
  private async getProjectIdAsync(): Promise<string> {
    const { exp } = getConfig(this.ctx.projectDir, { skipSDKVersionRequirement: true });
    return await ensureProjectExistsAsync({
      accountName: await getProjectAccountNameAsync(this.ctx.projectDir),
      projectName: exp.slug,
    });
  }

  private resolveAppSpecificPasswordSource(): Result<AppSpecificPasswordSource> {
    const { appleAppSpecificPassword } = this.ctx.commandFlags;
    const { EXPO_APPLE_APPLICATION_SPECIFIC_PASSWORD } = process.env;

    if (appleAppSpecificPassword) {
      return result({
        sourceType: AppSpecificPasswordSourceType.userDefined,
        appSpecificPassword: appleAppSpecificPassword,
      });
    } else if (EXPO_APPLE_APPLICATION_SPECIFIC_PASSWORD) {
      return result({
        sourceType: AppSpecificPasswordSourceType.userDefined,
        appSpecificPassword: EXPO_APPLE_APPLICATION_SPECIFIC_PASSWORD,
      });
    }

    return result({
      sourceType: AppSpecificPasswordSourceType.prompt,
    });
  }

  private resolveArchiveSource(projectId: string): Result<ArchiveSource> {
    return result({
      archiveFile: this.resolveArchiveFileSource(projectId),
      archiveType: { sourceType: ArchiveTypeSourceType.infer },
    });
  }

  // TODO: this is common with android part
  private resolveArchiveFileSource(projectId: string): ArchiveFileSource {
    const { url, path, id, latest } = this.ctx.commandFlags;
    const chosenOptions = [url, path, id, latest];
    if (chosenOptions.filter(opt => opt).length > 1) {
      throw new Error(`Pass only one of: --url, --path, --id, --latest`);
    }

    if (url) {
      return {
        sourceType: ArchiveFileSourceType.url,
        url,
        projectId,
        platform: SubmissionPlatform.iOS,
        projectDir: this.ctx.projectDir,
      };
    } else if (path) {
      return {
        sourceType: ArchiveFileSourceType.path,
        path,
        projectId,
        platform: SubmissionPlatform.iOS,
        projectDir: this.ctx.projectDir,
      };
    } else if (id) {
      if (!uuid.validate(id)) {
        throw new Error(`${id} is not an ID`);
      }
      return {
        sourceType: ArchiveFileSourceType.buildId,
        id,
        projectId,
        platform: SubmissionPlatform.iOS,
        projectDir: this.ctx.projectDir,
      };
    } else if (latest) {
      return {
        sourceType: ArchiveFileSourceType.latest,
        platform: SubmissionPlatform.iOS,
        projectDir: this.ctx.projectDir,
        projectId,
      };
    } else {
      return {
        sourceType: ArchiveFileSourceType.prompt,
        platform: SubmissionPlatform.iOS,
        projectDir: this.ctx.projectDir,
        projectId,
      };
    }
  }

  /**
   * This is going to be used only when `produce` is not being run,
   * and we don't need to call full credentials.authenticateAsync()
   * and we just need apple ID
   */
  private async getAppleIdAsync(): Promise<string> {
    const { appleId } = this.ctx.commandFlags;
    const { EXPO_APPLE_ID } = process.env;

    if (appleId) {
      return appleId;
    } else if (EXPO_APPLE_ID) {
      return EXPO_APPLE_ID;
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

  /**
   * _App Apple ID_ - **THIS IS NOT** "Apple ID".
   * It is an unique application number, which can be found in _App Store Connect_
   * under `General -> App Information -> General information`
   *
   * It is also returned from `fastlane produce` and this method is gonna be
   * reimplemented to support this
   */
  private async getAppAppleIdAsync(): Promise<string> {
    const { appAppleId } = this.ctx.commandFlags;

    if (appAppleId) {
      return appAppleId;
    }

    const wrap = wordwrap(process.stdout.columns || 80);
    log.addNewLineIfNone();
    log(
      wrap(
        'Enter your App Store Connect application Apple ID number. It can be found under ' +
          chalk.italic('General -> App Information -> General Information')
      )
    );

    const { appAppleIdAnswer } = await promptAsync({
      name: 'appAppleIdAnswer',
      message: 'Application Apple ID number:',
      type: 'text',
      validate: (val: string) => val !== '' || 'Application Apple ID cannot be empty!',
    });

    return appAppleIdAnswer;
  }
}

export default IosSubmitCommand;
