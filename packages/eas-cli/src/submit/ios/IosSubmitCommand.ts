import { Platform } from '@expo/eas-build-job';
import { Result, result } from '@expo/results';
import chalk from 'chalk';
import getenv from 'getenv';
import wrapAnsi from 'wrap-ansi';

import { MissingCredentialsError } from '../../credentials/errors';
import { SubmissionFragment } from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';
import UserSettings from '../../user/UserSettings';
import { ArchiveSource } from '../ArchiveSource';
import { resolveArchiveSource } from '../commons';
import { SubmissionContext } from '../context';
import { ensureAppStoreConnectAppExistsAsync } from './AppProduce';
import {
  AppSpecificPasswordSource,
  AppSpecificPasswordSourceType,
} from './AppSpecificPasswordSource';
import { AscApiKeySource, AscApiKeySourceType } from './AscApiKeySource';
import IosSubmitter, { IosSubmissionOptions } from './IosSubmitter';

export default class IosSubmitCommand {
  constructor(private ctx: SubmissionContext<Platform.IOS>) {}

  async runAsync(): Promise<SubmissionFragment> {
    Log.addNewLineIfNone();
    const options = await this.resolveSubmissionOptionsAsync();
    const submitter = new IosSubmitter(this.ctx, options);
    return await submitter.submitAsync();
  }

  private async resolveCredentialSubmissionOptionsAsync(): Promise<
    | { appSpecificPasswordSource: Result<AppSpecificPasswordSource> }
    | { ascApiKeySource: Result<AscApiKeySource> }
  > {
    // Fall back to app specific password if no ascApiKey defined
    const ascApiKeySource = this.resolveAscApiKeySource();
    const shouldUseAppSpecificPassword =
      !ascApiKeySource.ok && ascApiKeySource.enforceError() instanceof MissingCredentialsError;
    if (shouldUseAppSpecificPassword) {
      return { appSpecificPasswordSource: this.resolveAppSpecificPasswordSource() };
    } else {
      return { ascApiKeySource };
    }
  }

  private async resolveSubmissionOptionsAsync(): Promise<IosSubmissionOptions> {
    const archiveSource = this.resolveArchiveSource();
    const credentialsSource = await this.resolveCredentialSubmissionOptionsAsync();
    const maybeAppSpecificPasswordSource =
      'appSpecificPasswordSource' in credentialsSource
        ? credentialsSource.appSpecificPasswordSource
        : null;
    const maybeAscApiKeySource =
      'ascApiKeySource' in credentialsSource ? credentialsSource.ascApiKeySource : null;
    const ascAppIdentifier = await this.resolveAscAppIdentifierAsync();
    const appleIdUsername = await this.resolveAppleIdUsernameAsync();

    const errored = [
      archiveSource,
      ...(maybeAppSpecificPasswordSource ? [maybeAppSpecificPasswordSource] : []),
      ...(maybeAscApiKeySource ? [maybeAscApiKeySource] : []),
      ascAppIdentifier,
      appleIdUsername,
    ].filter(r => !r.ok);
    if (errored.length > 0) {
      const message = errored.map(err => err.reason?.message).join('\n');
      Log.error(message);
      throw new Error('Submission failed');
    }

    return {
      projectId: this.ctx.projectId,
      appleIdUsername: appleIdUsername.enforceValue(),
      ascAppIdentifier: ascAppIdentifier.enforceValue(),
      archiveSource: archiveSource.enforceValue(),
      ...(maybeAppSpecificPasswordSource
        ? {
            appSpecificPasswordSource: maybeAppSpecificPasswordSource.enforceValue(),
          }
        : null),
      ...(maybeAscApiKeySource
        ? {
            ascApiKeySource: maybeAscApiKeySource.enforceValue(),
          }
        : null),
    };
  }

  private resolveAppSpecificPasswordSource(): Result<AppSpecificPasswordSource> {
    const envAppSpecificPassword = getenv.string('EXPO_APPLE_APP_SPECIFIC_PASSWORD', '');

    if (envAppSpecificPassword) {
      return result({
        sourceType: AppSpecificPasswordSourceType.userDefined,
        appSpecificPassword: envAppSpecificPassword,
      });
    } else if (this.ctx.nonInteractive) {
      return result(new Error('Set the EXPO_APPLE_APP_SPECIFIC_PASSWORD environment variable.'));
    } else {
      return result({
        sourceType: AppSpecificPasswordSourceType.prompt,
      });
    }
  }

  private resolveAscApiKeySource(): Result<AscApiKeySource> {
    const { ascApiKeyPath, ascApiKeyIssuerId, ascApiKeyId } = this.ctx.profile;

    if (ascApiKeyPath && ascApiKeyIssuerId && ascApiKeyId) {
      return result({
        sourceType: AscApiKeySourceType.path,
        path: {
          keyP8Path: ascApiKeyPath,
          issuerId: ascApiKeyIssuerId,
          keyId: ascApiKeyId,
        },
      });
    }

    // interpret this to mean the user had some intention of passing in ASC Api key
    if (ascApiKeyPath || ascApiKeyIssuerId || ascApiKeyId) {
      Log.warn(`ascApiKeyPath, ascApiKeyIssuerId and ascApiKeyId must all be defined in eas.json`);
      return result({
        sourceType: AscApiKeySourceType.prompt,
      });
    }

    return result(
      new MissingCredentialsError(
        'Set the ascApiKeyPath, ascApiKeyIssuerId and ascApiKeyId fields in eas.json.'
      )
    );
  }

  private resolveArchiveSource(): Result<ArchiveSource> {
    try {
      return result(resolveArchiveSource(this.ctx, Platform.IOS));
    } catch (err: any) {
      return result(err);
    }
  }

  private async resolveAscAppIdentifierAsync(): Promise<Result<string>> {
    const { ascAppId } = this.ctx.profile;
    if (ascAppId) {
      return result(ascAppId);
    } else if (this.ctx.nonInteractive) {
      return result(new Error('Set ascAppId in the submit profile (eas.json).'));
    } else {
      Log.log(
        wrapAnsi(
          `Ensuring your app exists on App Store Connect. This step can be skipped by providing ${chalk.bold(
            `ascAppId`
          )} in the submit profile. ${learnMore('https://expo.fyi/asc-app-id')}`,
          process.stdout.columns || 80
        )
      );
      Log.addNewLineIfNone();
      try {
        const { ascAppIdentifier } = await ensureAppStoreConnectAppExistsAsync(this.ctx);
        return result(ascAppIdentifier);
      } catch (err: any) {
        return result(err);
      }
    }
  }

  private async resolveAppleIdUsernameAsync(): Promise<Result<string>> {
    if (this.ctx.profile.appleId) {
      return result(this.ctx.profile.appleId);
    }

    const envAppleId = getenv.string('EXPO_APPLE_ID', '');
    if (envAppleId) {
      return result(envAppleId);
    }

    if (this.ctx.credentialsCtx.appStore.authCtx?.appleId) {
      return result(this.ctx.credentialsCtx.appStore.authCtx.appleId);
    }

    // Get the email address that was last used and set it as
    // the default value for quicker authentication.
    const lastAppleId = await UserSettings.getAsync('appleId', null);

    if (this.ctx.nonInteractive) {
      if (lastAppleId) {
        return result(lastAppleId);
      } else {
        return result(new Error('Set appleId in the submit profile (eas.json).'));
      }
    }

    const { appleId } = await promptAsync({
      type: 'text',
      name: 'appleId',
      message: `Enter your Apple ID:`,
      validate: (val: string) => !!val,
      initial: lastAppleId ?? undefined,
    });
    return result(appleId);
  }
}
