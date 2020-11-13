import { Result, result } from '@expo/results';
import chalk from 'chalk';
import wordwrap from 'wordwrap';

import log from '../../log';
import { getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import UserSettings from '../../user/UserSettings';
import { ArchiveSource, ArchiveTypeSourceType } from '../archiveSource';
import { resolveArchiveFileSource } from '../commons';
import { IosSubmissionContext, IosSubmitCommandFlags, SubmissionPlatform } from '../types';
import { runProduceAsync } from './AppProduce';
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

    const { appleId, appAppleId } = await this.getAppStoreInfoAsync();

    return {
      projectId,
      appleId,
      appAppleId,
      archiveSource: archiveSource.enforceValue(),
      appSpecificPasswordSource: appSpecificPasswordSource.enforceValue(),
    };
  }

  private resolveAppSpecificPasswordSource(): Result<AppSpecificPasswordSource> {
    const { EXPO_APPLE_APP_SPECIFIC_PASSWORD } = process.env;

    if (EXPO_APPLE_APP_SPECIFIC_PASSWORD) {
      return result({
        sourceType: AppSpecificPasswordSourceType.userDefined,
        appSpecificPassword: EXPO_APPLE_APP_SPECIFIC_PASSWORD,
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

  ///////////////////////////////////////// WIP //////////////////////

  /**
   * @returns _App Apple ID_ - **THIS IS NOT** "Apple ID".
   * It is an unique application number, which can be found in _App Store Connect_
   * under `General -> App Information -> General information`
   */
  private async getAppStoreInfoAsync(): Promise<{
    appleId: string;
    appAppleId: string;
  }> {
    const { appAppleId } = this.ctx.commandFlags;

    if (appAppleId) {
      return {
        appleId: await this.getAppleIdAsync(),
        appAppleId,
      };
    }

    // TODO: Resolve bundleIdentifier from exp.ios.bundleIdentifier
    // Resolve appName from exp.name

    /*
  [non-interactive] You have to provide it in non-interactive mode or sth

  You haven't provided your App Store Connect App Apple ID. What would you like to do?
  - Let EAS handle it! (It will create app if it doesn't exist)
  - I have already app in App Store Connect (enter the App Apple ID)
  */
    const { choice } = await promptAsync({
      type: 'select',
      name: 'choice',
      message:
        "You haven't provided your App Store Connect App Apple ID. What would you like to do?",
      choices: [
        { value: 'produce', title: "Let EAS Handle it! (Create app if it doesn't exist)" },
        { value: 'prompt', title: 'I have already an App Store Connect app' },
      ],
    });

    switch (choice) {
      case 'prompt':
        return {
          appleId: await this.getAppleIdAsync(),
          appAppleId: await this.promptForAppAppleIdAsync(),
        };
      case 'produce':
      default:
        return await runProduceAsync(this.ctx.commandFlags);
    }
  }

  private async promptForAppAppleIdAsync(): Promise<string> {
    const wrap = wordwrap(process.stdout.columns || 80);
    log.addNewLineIfNone();
    log(
      wrap(
        'Enter your App Store Connect application Apple ID number. It can be found in App Store Connect under ' +
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
}

export default IosSubmitCommand;
