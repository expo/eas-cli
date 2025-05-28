import { Platform } from '@expo/eas-build-job';
import { Result, result } from '@expo/results';
import chalk from 'chalk';
import getenv from 'getenv';
import wrapAnsi from 'wrap-ansi';

import { ensureAppStoreConnectAppExistsAsync } from './AppProduce';
import {
  AppSpecificPasswordSource,
  AppSpecificPasswordSourceType,
} from './AppSpecificPasswordSource';
import { AscApiKeySource, AscApiKeySourceType } from './AscApiKeySource';
import IosSubmitter, { IosSubmissionOptions } from './IosSubmitter';
import { MissingCredentialsError } from '../../credentials/errors';
import Log, { learnMore } from '../../log';
import { ArchiveSource, ArchiveSourceType, getArchiveAsync } from '../ArchiveSource';
import { refreshContextSubmitProfileAsync, resolveArchiveSource } from '../commons';
import { SubmissionContext } from '../context';

export default class IosSubmitCommand {
  constructor(private ctx: SubmissionContext<Platform.IOS>) {}

  async runAsync(): Promise<IosSubmitter> {
    Log.addNewLineIfNone();
    const archiveSource = this.resolveArchiveSource();
    if (!archiveSource.ok) {
      Log.error(archiveSource.reason?.message);
      throw new Error('Submission failed');
    }

    const archiveSourceValue = archiveSource.enforceValue();
    const archive = await getArchiveAsync(
      {
        graphqlClient: this.ctx.graphqlClient,
        platform: Platform.IOS,
        projectId: this.ctx.projectId,
        nonInteractive: this.ctx.nonInteractive,
      },
      archiveSourceValue
    );
    const archiveProfile =
      archive.sourceType === ArchiveSourceType.build ? archive.build.buildProfile : undefined;

    if (archiveProfile && !this.ctx.specifiedProfile) {
      this.ctx = await refreshContextSubmitProfileAsync(this.ctx, archiveProfile);
    }
    const options = await this.resolveSubmissionOptionsAsync(archiveSourceValue);
    const submitter = new IosSubmitter(this.ctx, options, archive);
    return submitter;
  }

  private async resolveSubmissionOptionsAsync(
    archiveSource: ArchiveSource
  ): Promise<IosSubmissionOptions> {
    const credentialsSource = await this.resolveCredentialSubmissionOptionsAsync();
    const maybeAppSpecificPasswordSource =
      'appSpecificPasswordSource' in credentialsSource
        ? credentialsSource.appSpecificPasswordSource
        : null;
    const maybeAscApiKeySource =
      'ascApiKeySource' in credentialsSource ? credentialsSource.ascApiKeySource : null;
    const ascAppIdentifier = await this.resolveAscAppIdentifierAsync();

    const errored = [
      ...(maybeAppSpecificPasswordSource ? [maybeAppSpecificPasswordSource] : []),
      ...(maybeAscApiKeySource ? [maybeAscApiKeySource] : []),
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
      archiveSource,
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

  private async resolveCredentialSubmissionOptionsAsync(): Promise<
    | { appSpecificPasswordSource: Result<AppSpecificPasswordSource> }
    | { ascApiKeySource: Result<AscApiKeySource> }
  > {
    // if an App Specific Password env var is not specified, use ASC Api Key
    const appSpecificPasswordSource = this.resolveAppSpecificPasswordSource();
    const shouldSkipAppSpecificPasswordSource =
      !appSpecificPasswordSource.ok &&
      appSpecificPasswordSource.enforceError() instanceof MissingCredentialsError;
    if (!shouldSkipAppSpecificPasswordSource) {
      return { appSpecificPasswordSource: this.resolveAppSpecificPasswordSource() };
    }

    const ascApiKeySource = this.resolveAscApiKeySource();
    return { ascApiKeySource };
  }

  private resolveAppSpecificPasswordSource(): Result<AppSpecificPasswordSource> {
    const envAppSpecificPassword = getenv.string('EXPO_APPLE_APP_SPECIFIC_PASSWORD', '');

    if (envAppSpecificPassword) {
      if (!/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(envAppSpecificPassword)) {
        throw new Error(
          'EXPO_APPLE_APP_SPECIFIC_PASSWORD must be in the format xxxx-xxxx-xxxx-xxxx, where x is a lowercase letter.'
        );
      }
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
      const message = `ascApiKeyPath, ascApiKeyIssuerId and ascApiKeyId must all be defined in eas.json`;

      // in non-interactive mode, we should fail
      if (this.ctx.nonInteractive) {
        throw new Error(message);
      }

      Log.warn(message);
      return result({
        sourceType: AscApiKeySourceType.prompt,
      });
    }

    return result({ sourceType: AscApiKeySourceType.credentialsService });
  }

  private resolveArchiveSource(): Result<ArchiveSource> {
    try {
      return result(resolveArchiveSource(this.ctx));
    } catch (err: any) {
      return result(err);
    }
  }

  private async resolveAscAppIdentifierAsync(): Promise<Result<string>> {
    const { ascAppId } = this.ctx.profile;
    if (ascAppId) {
      return result(ascAppId);
    } else if (this.ctx.nonInteractive) {
      return result(
        new Error(
          'Set ascAppId in the submit profile (eas.json) or re-run this command in interactive mode.'
        )
      );
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
