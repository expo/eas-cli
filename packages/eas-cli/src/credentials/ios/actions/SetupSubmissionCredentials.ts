import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';

import { CommonIosAppCredentialsFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { UnsupportedCredentialsChoiceError } from '../../errors';
import { AppLookupParams } from '../api/GraphqlClient';
import { AppStoreApiKeyPurpose } from './AscApiKeyUtils';
import { SetupAscApiKey } from './SetupAscApiKey';

const PROMPT_FOR_APP_SPECIFIC_PASSWORD = 'PROMPT_FOR_APP_SPECIFIC_PASSWORD';
export class SetupSubmissionCredential {
  private setupAscApiKeyAction;
  constructor(app: AppLookupParams) {
    this.setupAscApiKeyAction = new SetupAscApiKey(app, AppStoreApiKeyPurpose.SUBMISSION_SERVICE);
    this.setupAscApiKeyAction.choices = this.setupAscApiKeyAction.choices.concat({
      title: '[Enter an App Specific Password]',
      value: PROMPT_FOR_APP_SPECIFIC_PASSWORD,
    });
  }

  public async runAsync(
    ctx: CredentialsContext
  ): Promise<CommonIosAppCredentialsFragment | string> {
    try {
      return await this.setupAscApiKeyAction.runAsync(ctx);
    } catch (e) {
      if (e instanceof UnsupportedCredentialsChoiceError) {
        const choice = e.choice;
        if (choice === PROMPT_FOR_APP_SPECIFIC_PASSWORD) {
          return await this.promptForAppSpecificPasswordAsync();
        }
      }
      throw e;
    }
  }

  async promptForAppSpecificPasswordAsync(): Promise<string> {
    Log.addNewLineIfNone();
    Log.warn(
      wrapAnsi(
        `This option will be deprecated soon. You will still be able to provide your password with the ${chalk.bold(
          'EXPO_APPLE_APP_SPECIFIC_PASSWORD'
        )} environment variable.`,
        process.stdout.columns || 80
      )
    );
    Log.log(`Please enter your Apple app-specific password.`);
    Log.log(learnMore('https://expo.fyi/apple-app-specific-password'));

    const { appSpecificPassword } = await promptAsync({
      name: 'appSpecificPassword',
      message: 'Your Apple app-specific password:',
      type: 'password',
      validate: (val: string) => val !== '' || 'Apple app-specific password cannot be empty!',
    });
    return appSpecificPassword;
  }
}
