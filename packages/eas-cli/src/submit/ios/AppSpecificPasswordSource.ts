import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';

import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';

export enum AppSpecificPasswordSourceType {
  userDefined,
  prompt,
}

interface AppSpecificPasswordSourceBase {
  sourceType: AppSpecificPasswordSourceType;
}

interface AppSpecificPasswordUserDefinedSource extends AppSpecificPasswordSourceBase {
  sourceType: AppSpecificPasswordSourceType.userDefined;
  appSpecificPassword: string;
}

interface AppSpecificPasswordPromptSource extends AppSpecificPasswordSourceBase {
  sourceType: AppSpecificPasswordSourceType.prompt;
}

export type AppSpecificPasswordSource =
  | AppSpecificPasswordUserDefinedSource
  | AppSpecificPasswordPromptSource;

export async function getAppSpecificPasswordAsync(
  source: AppSpecificPasswordSource
): Promise<string> {
  if (source.sourceType === AppSpecificPasswordSourceType.userDefined) {
    return source.appSpecificPassword;
  } else if (source.sourceType === AppSpecificPasswordSourceType.prompt) {
    Log.addNewLineIfNone();
    Log.log(
      wrapAnsi(
        `Please enter your Apple app-specific password. You can also provide it by using the ${chalk.bold(
          'EXPO_APPLE_APP_SPECIFIC_PASSWORD'
        )} environment variable.`,
        process.stdout.columns || 80
      )
    );
    Log.log(learnMore('https://expo.fyi/apple-app-specific-password'));

    const { appSpecificPassword } = await promptAsync({
      name: 'appSpecificPassword',
      message: 'Your Apple app-specific password:',
      type: 'password',
      validate: (val: string) => val !== '' || 'Apple app-specific password cannot be empty!',
    });
    return appSpecificPassword;
  } else {
    // exhaustive -- should never happen
    throw new Error(`Unknown app specific password source type "${(source as any)?.sourceType}"`);
  }
}
