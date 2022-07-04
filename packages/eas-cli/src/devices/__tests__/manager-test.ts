import prompts from 'prompts';

import Log from '../../log.js';
import { Actor } from '../../user/User.js';
import { AccountResolver } from '../manager.js';

jest.mock('prompts');

jest.mock('../../project/projectUtils', () => {
  return {
    getProjectAccountNameAsync: () => 'foo',
  };
});
jest.mock('../../credentials/ios/api/graphql/queries/AppleTeamQuery');

beforeEach(() => {
  jest.mocked(prompts).mockReset();
  jest.mocked(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
});

describe(AccountResolver, () => {
  describe('#resolveAccountAsync', () => {
    const user: Actor = {
      __typename: 'User',
      id: 'user_id_666',
      username: 'dominik',
      accounts: [
        { id: 'account_id_777', name: 'dominik' },
        { id: 'account_id_888', name: 'foo' },
      ],
      isExpoAdmin: false,
    };

    describe('when inside project dir', () => {
      const exp = {} as any;

      it('returns the account defined in app.json/app.config.js if user confirms', async () => {
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          value: true,
        }));

        const resolver = new AccountResolver(exp, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[1]);
      });

      it('asks the user to choose the account from his account list if he rejects to use the one defined in app.json / app.config.js', async () => {
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          useProjectAccount: false,
        }));
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(exp, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });

      it(`asks the user to choose the account from his account list if he doesn't have access to the account defined in app.json / app.config.js`, async () => {
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          account: user.accounts[0],
        }));

        const userWithAccessToProjectAccount: Actor = {
          ...user,
          accounts: [user.accounts[0]],
        };

        jest.spyOn(Log, 'warn');
        const resolver = new AccountResolver(exp, userWithAccessToProjectAccount);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
        expect(Log.warn).toBeCalledWith(expect.stringMatching(/doesn't have access to the/));
      });
    });

    describe('when outside project dir', () => {
      it('asks the user to choose the account from his account list', async () => {
        jest.mocked(prompts).mockImplementationOnce(async () => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(null, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });
    });
  });
});
