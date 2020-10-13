import chalk from 'chalk';

import { generateDeviceRegistrationURL } from '../../credentials/ios/adhoc/devices';
import log from '../../log';
import { promptAsync } from '../../prompts';
import { Account } from '../../user/Account';

export enum RegistrationMethod {
  WEBSITE,
  INPUT,
  EXIT,
}

export default class DeviceCreateAction {
  constructor(private account: Account, private appleTeamId: string) {}

  public async runAsync(): Promise<void> {
    const method = await this.askForRegistrationMethodAsync();

    if (method === RegistrationMethod.WEBSITE) {
      await generateDeviceRegistrationURL(this.account, this.appleTeamId);
    } else if (method === RegistrationMethod.INPUT) {
      throw new Error('not implemented yet');
    } else if (method === RegistrationMethod.EXIT) {
      log('Bye!');
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
