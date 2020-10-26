import chalk from 'chalk';

import {
  AppleTeam as AppleTeamGraphQL,
  createAppleTeamAsync,
  findAppleTeamAsync,
} from '../../../credentials/ios/api/AppleTeam';
import { Team as AppleTeam } from '../../../credentials/ios/appstore/authenticate';
import log from '../../../log';
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
  constructor(private account: Account, private appleTeam: AppleTeam) {}

  public async runAsync(): Promise<void> {
    const appleTeam = await this.ensureAppleTeamExistsAsync();
    const method = await this.askForRegistrationMethodAsync();
    if (method === RegistrationMethod.WEBSITE) {
      await runRegistrationUrlMethodAsync(this.account.id, appleTeam);
    } else if (method === RegistrationMethod.INPUT) {
      await runInputMethodAsync(this.account.id, appleTeam);
    } else if (method === RegistrationMethod.EXIT) {
      log('Bye!');
      process.exit(0);
    }
  }

  private async ensureAppleTeamExistsAsync(): Promise<AppleTeamGraphQL> {
    const appleTeam = await findAppleTeamAsync({
      accountId: this.account.id,
      appleTeamIdentifier: this.appleTeam.id,
    });
    if (appleTeam) {
      return appleTeam;
    } else {
      return await createAppleTeamAsync(
        {
          appleTeamIdentifier: this.appleTeam.id,
          appleTeamName: this.appleTeam.name,
        },
        this.account.id
      );
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
