import chalk from 'chalk';

import { runCurrentMachineMethodAsync } from './currentMachineMethod';
import { runDeveloperPortalMethodAsync } from './developerPortalMethod';
import { runInputMethodAsync } from './inputMethod';
import { runRegistrationUrlMethodAsync } from './registrationUrlMethod';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import AppStoreApi from '../../../credentials/ios/appstore/AppStoreApi';
import { AccountFragment, AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';

export enum RegistrationMethod {
  WEBSITE,
  INPUT,
  DEVELOPER_PORTAL,
  CURRENT_MACHINE,
  EXIT,
}

export default class DeviceCreateAction {
  constructor(
    private readonly graphqlClient: ExpoGraphqlClient,
    private readonly appStoreApi: AppStoreApi,
    private readonly account: AccountFragment,
    private readonly appleTeam: Pick<AppleTeam, 'appleTeamIdentifier' | 'appleTeamName' | 'id'>
  ) {}

  public async runAsync(): Promise<RegistrationMethod> {
    const method = await this.askForRegistrationMethodAsync();
    if (method === RegistrationMethod.WEBSITE) {
      await runRegistrationUrlMethodAsync(this.graphqlClient, this.account.id, this.appleTeam);
    } else if (method === RegistrationMethod.DEVELOPER_PORTAL) {
      await runDeveloperPortalMethodAsync(
        this.graphqlClient,
        this.appStoreApi,
        this.account,
        this.appleTeam
      );
    } else if (method === RegistrationMethod.INPUT) {
      await runInputMethodAsync(this.graphqlClient, this.account.id, this.appleTeam);
    } else if (method === RegistrationMethod.CURRENT_MACHINE) {
      await runCurrentMachineMethodAsync(this.graphqlClient, this.account.id, this.appleTeam);
    } else if (method === RegistrationMethod.EXIT) {
      Log.log('Bye!');
      process.exit(0);
    }
    return method;
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
          title: `${chalk.bold(
            'Developer Portal'
          )} - import devices already registered on Apple Developer Portal`,
          value: RegistrationMethod.DEVELOPER_PORTAL,
        },
        {
          title: `${chalk.bold('Input')} - allows you to type in UDIDs (advanced option)`,
          value: RegistrationMethod.INPUT,
        },
        {
          title: `${chalk.bold(
            'Current Machine'
          )} - automatically sets the provisioning UDID of the current Apple Silicon machine`,
          value: RegistrationMethod.CURRENT_MACHINE,
        },
        { title: chalk.bold('Exit'), value: RegistrationMethod.EXIT },
      ],
      validate: (val: RegistrationMethod) => Object.values(RegistrationMethod).includes(val),
      initial: RegistrationMethod.WEBSITE,
    });
    return method;
  }
}
