import prompts from 'prompts';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import AppStoreApi from '../../../../credentials/ios/appstore/AppStoreApi';
import { AccountFragment, Role } from '../../../../graphql/generated';
import DeviceCreateAction, { RegistrationMethod } from '../action';
import { runCurrentMachineMethodAsync } from '../currentMachineMethod';
import { runDeveloperPortalMethodAsync } from '../developerPortalMethod';
import { runInputMethodAsync } from '../inputMethod';
import { runRegistrationUrlMethodAsync } from '../registrationUrlMethod';

jest.mock('prompts');
jest.mock('../developerPortalMethod');
jest.mock('../inputMethod');
jest.mock('../registrationUrlMethod');
jest.mock('../currentMachineMethod');

beforeEach(() => {
  const promptsMock = jest.mocked(prompts);
  promptsMock.mockReset();
  promptsMock.mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
  jest.mocked(runRegistrationUrlMethodAsync).mockClear();
  jest.mocked(runInputMethodAsync).mockClear();
  jest.mocked(runCurrentMachineMethodAsync).mockClear();
});

describe(DeviceCreateAction, () => {
  describe('#runAsync', () => {
    it('calls runRegistrationUrlMethodAsync if user chooses the website method', async () => {
      jest.mocked(prompts).mockImplementationOnce(async () => ({
        method: RegistrationMethod.WEBSITE,
      }));
      const appStoreApiMock = mock<AppStoreApi>();
      const appStoreApi = instance(appStoreApiMock);
      const graphqlClient = instance(mock<ExpoGraphqlClient>());

      const account: AccountFragment = {
        id: 'account_id',
        name: 'foobar',
        users: [
          {
            role: Role.Owner,
            actor: {
              id: 'user_id',
            },
          },
        ],
      };
      const appleTeam = {
        id: 'apple-team-id',
        appleTeamIdentifier: 'ABC123Y',
        appleTeamName: 'John Doe (Individual)',
      };
      const action = new DeviceCreateAction(graphqlClient, appStoreApi, account, appleTeam);
      await action.runAsync();

      expect(runRegistrationUrlMethodAsync).toBeCalled();
    });

    it('calls runInputMethodAsync if user chooses the input method', async () => {
      jest.mocked(prompts).mockImplementationOnce(async () => ({
        method: RegistrationMethod.INPUT,
      }));
      const appStoreApiMock = mock<AppStoreApi>();
      const appStoreApi = instance(appStoreApiMock);
      const graphqlClient = instance(mock<ExpoGraphqlClient>());

      const account: AccountFragment = {
        id: 'account_id',
        name: 'foobar',
        users: [
          {
            role: Role.Owner,
            actor: {
              id: 'user_id',
            },
          },
        ],
      };
      const appleTeam = {
        id: 'apple-team-id',
        appleTeamIdentifier: 'ABC123Y',
        appleTeamName: 'John Doe (Individual)',
      };
      const action = new DeviceCreateAction(graphqlClient, appStoreApi, account, appleTeam);
      await action.runAsync();

      expect(runInputMethodAsync).toBeCalled();
    });

    it('calls runDeveloperPortalMethodAsync if user chooses the developer portal method', async () => {
      jest.mocked(prompts).mockImplementationOnce(async () => ({
        method: RegistrationMethod.DEVELOPER_PORTAL,
      }));
      const appStoreApiMock = mock<AppStoreApi>();
      const appStoreApi = instance(appStoreApiMock);
      const graphqlClient = instance(mock<ExpoGraphqlClient>());

      const account: AccountFragment = {
        id: 'account_id',
        name: 'foobar',
        users: [
          {
            role: Role.Owner,
            actor: {
              id: 'user_id',
            },
          },
        ],
      };
      const appleTeam = {
        id: 'apple-team-id',
        appleTeamIdentifier: 'ABC123Y',
        appleTeamName: 'John Doe (Individual)',
      };
      const action = new DeviceCreateAction(graphqlClient, appStoreApi, account, appleTeam);
      await action.runAsync();

      expect(runDeveloperPortalMethodAsync).toBeCalled();
    });

    it('calls runCurrentMachineMethodAsync if user chooses the current machine method', async () => {
      jest.mocked(prompts).mockImplementationOnce(async () => ({
        method: RegistrationMethod.CURRENT_MACHINE,
      }));
      const appStoreApiMock = mock<AppStoreApi>();
      const appStoreApi = instance(appStoreApiMock);
      const graphqlClient = instance(mock<ExpoGraphqlClient>());

      const account: AccountFragment = {
        id: 'account_id',
        name: 'foobar',
        users: [
          {
            role: Role.Owner,
            actor: {
              id: 'user_id',
            },
          },
        ],
      };
      const appleTeam = {
        id: 'apple-team-id',
        appleTeamIdentifier: 'ABC123Y',
        appleTeamName: 'John Doe (Individual)',
      };
      const action = new DeviceCreateAction(graphqlClient, appStoreApi, account, appleTeam);
      await action.runAsync();

      expect(runCurrentMachineMethodAsync).toBeCalled();
    });
  });
});
