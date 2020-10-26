import prompts from 'prompts';

import { asMock } from '../../../../__tests__/utils';
import { Team as AppleTeam } from '../../../../credentials/ios/appstore/authenticate';
import { Account } from '../../../../user/Account';
import DeviceCreateAction, { RegistrationMethod } from '../action';
import { runUrlMethodAsync } from '../urlMethod';
import { runInputMethodAsync } from '../inputMethod';

const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
});

jest.mock('prompts');
jest.mock('../urlMethod');
jest.mock('../inputMethod');
jest.mock('../../../../credentials/ios/api/AppleTeam');

beforeEach(() => {
  const promptsMock = asMock(prompts);
  promptsMock.mockReset();
  promptsMock.mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
  asMock(runUrlMethodAsync).mockClear();
  asMock(runInputMethodAsync).mockClear();
});

describe(DeviceCreateAction, () => {
  describe('#runAsync', () => {
    it('calls runUrlMethodAsync if user chooses the website method', async () => {
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

      expect(runUrlMethodAsync).toBeCalled();
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
