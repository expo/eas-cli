import chalk from 'chalk';
import wordwrap from 'wordwrap';

import log from '../../log';
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

export async function getAppSpecificPasswordAsync(source: AppSpecificPasswordSource) {
  if (source.sourceType === AppSpecificPasswordSourceType.userDefined) {
    return source.appSpecificPassword;
  } else if (source.sourceType === AppSpecificPasswordSourceType.prompt) {
    log.addNewLineIfNone();
    const wrap = wordwrap(process.stdout.columns || 80);
    log(
      wrap(
        chalk.bold(
          `The password is only used to upload the build to Apple TestFlight and never stored on Expo servers`
        )
      )
    );

    const { appSpecificPassword } = await promptAsync({
      name: 'appSpecificPassword',
      message: 'Your Apple app-specific password:',
      type: 'text',
      validate: (val: string) => val !== '' || 'Apple app-specific password cannot be empty!',
    });
    return appSpecificPassword;
  } else {
    throw new Error('This should never happen');
  }
}
