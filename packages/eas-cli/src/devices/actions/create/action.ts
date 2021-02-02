import chalk from 'chalk';

import { AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { runInputMethodAsync } from './inputMethod';
import { runRegistrationUrlMethodAsync } from './registrationUrlMethod';

export enum RegistrationMethod {
  WEBSITE,
  INPUT,
  EXIT,
}

export default class DeviceCreateAction {
  constructor(
    private account: Account,
    private appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
  ) {}

  public async runAsync(): Promise<void> {
    const method = await this.askForRegistrationMethodAsync();
    if (method === RegistrationMethod.WEBSITE) {
      await runRegistrationUrlMethodAsync(this.account.id, this.appleTeam);
    } else if (method === RegistrationMethod.INPUT) {
      await runInputMethodAsync(this.account.id, this.appleTeam);
    } else if (method === RegistrationMethod.EXIT) {
      Log.log('Bye!');
      process.exit(0);
    }
  }

  private async askForRegistrationMethodAsync(): Promise<RegistrationMethod> {
    const { method } = await promptAsync({
      type: 'select',
      name: 'method',
      message: `How would you like to register your devices?`,
      choices: [
        {
          title: `${chalk.bold(
            'Website'
          )} - generates a registration URL to be opened on your devices`,
          value: RegistrationMethod.WEBSITE,
        },
        {
          title: `${chalk.bold('Input')} - allows you to type in UDIDs (advanced option)`,
          value: RegistrationMethod.INPUT,
        },
        { title: chalk.bold('Exit'), value: RegistrationMethod.EXIT },
      ],
      validate: (val: RegistrationMethod) => Object.values(RegistrationMethod).includes(val),
      initial: RegistrationMethod.WEBSITE,
    });
    return method;
  }
}
