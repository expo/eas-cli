import prompts from 'prompts';

import { asMock } from '../../../../__tests__/utils';
import { Team as AppleTeam } from '../../../../credentials/ios/appstore/authenticate';
import { Account } from '../../../../user/Account';
import DeviceCreateAction, { RegistrationMethod } from '../action';
import { runInputMethodAsync } from '../inputMethod';
import { runRegistrationUrlMethodAsync } from '../registrationUrlMethod';

const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
});

jest.mock('prompts');
jest.mock('../registrationUrlMethod');
jest.mock('../inputMethod');
jest.mock('../../../../credentials/ios/api/AppleTeam');

beforeEach(() => {
  const promptsMock = asMock(prompts);
  promptsMock.mockReset();
  promptsMock.mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
  asMock(runRegistrationUrlMethodAsync).mockClear();
  asMock(runInputMethodAsync).mockClear();
});

describe(DeviceCreateAction, () => {
  describe('#runAsync', () => {
    it('calls runRegistrationUrlMethodAsync if user chooses the website method', async () => {
      asMock(prompts).mockImplementationOnce(() => ({
        method: RegistrationMethod.WEBSITE,
      }));

      const account: Account = {
        id: 'account_id',
        name: 'foobar',
      };
      const appleTeam: AppleTeam = {
        id: 'ABC123Y',
        name: 'John Doe (Individual)',
      };
      const action = new DeviceCreateAction(account, appleTeam);
      await action.runAsync();

      expect(runRegistrationUrlMethodAsync).toBeCalled();
    });

    it('calls runInputMethodAsync if user chooses the input method', async () => {
      asMock(prompts).mockImplementationOnce(() => ({
        method: RegistrationMethod.INPUT,
      }));

      const account: Account = {
        id: 'account_id',
        name: 'foobar',
      };
      const appleTeam: AppleTeam = {
        id: 'ABC123Y',
        name: 'John Doe (Individual)',
      };
      const action = new DeviceCreateAction(account, appleTeam);
      await action.runAsync();

      expect(runInputMethodAsync).toBeCalled();
    });
  });
});
