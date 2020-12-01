import prompts from 'prompts';

import { asMock } from '../../../../__tests__/utils';
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
      const appleTeam = {
        id: 'apple-team-id',
        appleTeamIdentifier: 'ABC123Y',
        appleTeamName: 'John Doe (Individual)',
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
      const appleTeam = {
        id: 'apple-team-id',
        appleTeamIdentifier: 'ABC123Y',
        appleTeamName: 'John Doe (Individual)',
      };
      const action = new DeviceCreateAction(account, appleTeam);
      await action.runAsync();

      expect(runInputMethodAsync).toBeCalled();
    });
  });
});
