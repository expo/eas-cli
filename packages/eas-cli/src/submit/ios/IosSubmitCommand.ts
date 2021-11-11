import { Platform } from '@expo/eas-build-job';
import { Result, result } from '@expo/results';
import chalk from 'chalk';
import getenv from 'getenv';
import wrapAnsi from 'wrap-ansi';

import { MissingCredentialsError } from '../../credentials/errors';
import { SubmissionFragment } from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { ArchiveSource } from '../ArchiveSource';
import { resolveArchiveSource } from '../commons';
import { SubmissionContext } from '../context';
import { ensureAppStoreConnectAppExistsAsync } from './AppProduce';
import {
  AppSpecificPasswordSource,
  AppSpecificPasswordSourceType,
} from './AppSpecificPasswordSource';
import { AscApiKeySource, AscApiKeySourceType } from './AscApiKeySource';
import { CREDENTIALS_SERVICE_SOURCE, CredentialsServiceSource } from './CredentialsServiceSource';
import IosSubmitter, { IosSubmissionOptions } from './IosSubmitter';

export default class IosSubmitCommand {
  constructor(private ctx: SubmissionContext<Platform.IOS>) {}

  async runAsync(): Promise<SubmissionFragment> {
    Log.addNewLineIfNone();
    const options = await this.resolveSubmissionOptionsAsync();
    const submitter = new IosSubmitter(this.ctx, options);
    return await submitter.submitAsync();
  }

  private resolveCredentialSubmissionOptions():
    | { appSpecificPasswordSource: Result<AppSpecificPasswordSource> }
    | { ascApiKeySource: Result<AscApiKeySource> }
    | { credentialsServiceSource: Result<CredentialsServiceSource> } {
    const ascApiKeySource = this.resolveAscApiKeySource();
    const shouldSkipAscApiKeySource =
      !ascApiKeySource.ok && ascApiKeySource.enforceError() instanceof MissingCredentialsError;
    if (!shouldSkipAscApiKeySource) {
      return { ascApiKeySource };
    }

    const appSpecificPasswordSource = this.resolveAppSpecificPasswordSource();
    const shouldSkipAppSpecificPasswordSource =
      !appSpecificPasswordSource.ok &&
      appSpecificPasswordSource.enforceError() instanceof MissingCredentialsError;
    if (!shouldSkipAppSpecificPasswordSource) {
      return { appSpecificPasswordSource: this.resolveAppSpecificPasswordSource() };
    }

    return {
      credentialsServiceSource: result(CREDENTIALS_SERVICE_SOURCE),
    };
  }

  private async resolveSubmissionOptionsAsync(): Promise<IosSubmissionOptions> {
    const archiveSource = this.resolveArchiveSource();
    const credentialsSource = this.resolveCredentialSubmissionOptions();
    const maybeAppSpecificPasswordSource =
      'appSpecificPasswordSource' in credentialsSource
        ? credentialsSource.appSpecificPasswordSource
        : null;
    const maybeAscApiKeySource =
      'ascApiKeySource' in credentialsSource ? credentialsSource.ascApiKeySource : null;
    const maybeCredentialsServiceSource =
      'credentialsServiceSource' in credentialsSource
        ? credentialsSource.credentialsServiceSource
        : null;
    const ascAppIdentifier = await this.resolveAscAppIdentifierAsync();

    const errored = [
      archiveSource,
      ...(maybeAppSpecificPasswordSource ? [maybeAppSpecificPasswordSource] : []),
      ...(maybeAscApiKeySource ? [maybeAscApiKeySource] : []),
      ...(maybeCredentialsServiceSource ? [maybeCredentialsServiceSource] : []),
      ascAppIdentifier,
    ].filter(r => !r.ok);
    if (errored.length > 0) {
      const message = errored.map(err => err.reason?.message).join('\n');
      Log.error(message);
      throw new Error('Submission failed');
    }

    return {
      projectId: this.ctx.projectId,
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
      ...(maybeCredentialsServiceSource
        ? {
            credentialsServiceSource: maybeCredentialsServiceSource.enforceValue(),
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
    }

    return result(
      new MissingCredentialsError(
        'The EXPO_APPLE_APP_SPECIFIC_PASSWORD environment variable must be set.'
      )
    );
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
}
