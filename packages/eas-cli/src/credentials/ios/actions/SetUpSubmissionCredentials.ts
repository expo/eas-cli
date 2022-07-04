import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';

import { CommonIosAppCredentialsFragment } from '../../../graphql/generated.js';
import Log, { learnMore } from '../../../log.js';
import { promptAsync } from '../../../prompts.js';
import { nullthrows } from '../../../utils/nullthrows.js';
import { CredentialsContext } from '../../context.js';
import { UnsupportedCredentialsChoiceError } from '../../errors.js';
import { AppLookupParams } from '../api/GraphqlClient.js';
import { AppStoreApiKeyPurpose } from './AscApiKeyUtils.js';
import { SetUpAscApiKey } from './SetUpAscApiKey.js';

export const PROMPT_FOR_APP_SPECIFIC_PASSWORD = 'PROMPT_FOR_APP_SPECIFIC_PASSWORD';

export class SetUpSubmissionCredentials {
  private setupAscApiKeyAction;

  constructor(app: AppLookupParams) {
    this.setupAscApiKeyAction = new SetUpAscApiKey(app, AppStoreApiKeyPurpose.SUBMISSION_SERVICE);
    // Add this unrelated choice to ASC API Key setup for legacy purposes -- we will deprecate it soon
    this.setupAscApiKeyAction.choices = this.setupAscApiKeyAction.choices.concat({
      title: '[Enter an App Specific Password]',
      value: PROMPT_FOR_APP_SPECIFIC_PASSWORD,
    });
  }

  public async runAsync(
    ctx: CredentialsContext
  ): Promise<CommonIosAppCredentialsFragment | string> {
    try {
      const iosAppCredentials = await this.setupAscApiKeyAction.runAsync(ctx);
      const { keyIdentifier, name } = nullthrows(
        iosAppCredentials.appStoreConnectApiKeyForSubmissions,
        'ASC API Key must be defined for EAS Submit'
      );
      Log.log(`Using API Key ID: ${keyIdentifier}${name ? ` (${name})` : ''}`);
      return iosAppCredentials;
    } catch (e) {
      if (e instanceof UnsupportedCredentialsChoiceError) {
        if (e.choice === PROMPT_FOR_APP_SPECIFIC_PASSWORD) {
          return await this.promptForAppSpecificPasswordAsync();
        }
      }
      throw e;
    }
  }

  async promptForAppSpecificPasswordAsync(): Promise<string> {
    Log.addNewLineIfNone();
    Log.log(`Please enter your Apple app-specific password.`);
    Log.log(learnMore('https://expo.fyi/apple-app-specific-password'));
    Log.warn(
      wrapAnsi(
        `This option will be deprecated soon. You will still be able to provide your password with the ${chalk.bold(
          'EXPO_APPLE_APP_SPECIFIC_PASSWORD'
        )} environment variable.`,
        process.stdout.columns || 80
      )
    );

    const { appSpecificPassword } = await promptAsync({
      name: 'appSpecificPassword',
      message: 'Your Apple app-specific password:',
      type: 'password',
      validate: (val: string) => val !== '' || 'Apple app-specific password cannot be empty!',
    });
    return appSpecificPassword;
  }
}
