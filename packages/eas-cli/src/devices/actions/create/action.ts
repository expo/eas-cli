import chalk from 'chalk';
import indentString from 'indent-string';
import qrcodeTerminal from 'qrcode-terminal';

import log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { generateDeviceRegistrationURL } from './registration-url';

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
      this.generateDeviceRegistrationURLAsync();
    } else if (method === RegistrationMethod.INPUT) {
      throw new Error('not implemented yet');
    } else if (method === RegistrationMethod.EXIT) {
      log('Bye!');
      process.exit(0);
    }
  }

  private async generateDeviceRegistrationURLAsync() {
    const registrationURL = await generateDeviceRegistrationURL(this.account, this.appleTeamId);
    log.newLine();
    qrcodeTerminal.generate(registrationURL, code => console.log(`${indentString(code, 2)}\n`));
    log(
      'Open the following link on your iOS devices (or scan the QR code) and follow the instructions to install the development profile:'
    );
    log.newLine();
    log(chalk.green(`${registrationURL}`));
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
