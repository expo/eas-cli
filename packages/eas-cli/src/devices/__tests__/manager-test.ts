import prompts from 'prompts';

import { asMock } from '../../__tests__/utils';
import Log from '../../log';
import { Actor } from '../../user/User';
import { AccountResolver } from '../manager';

jest.mock('prompts');

jest.mock('../../project/projectUtils', () => {
  return {
    getProjectAccountNameAsync: () => 'foo',
  };
});
jest.mock('../../credentials/ios/api/graphql/queries/AppleTeamQuery');

beforeEach(() => {
  asMock(prompts).mockReset();
  asMock(prompts).mockImplementation(() => {
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
        asMock(prompts).mockImplementationOnce(() => ({
          value: true,
        }));

        const resolver = new AccountResolver(exp, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[1]);
      });

      it('asks the user to choose the account from his account list if he rejects to use the one defined in app.json / app.config.js', async () => {
        asMock(prompts).mockImplementationOnce(() => ({
          useProjectAccount: false,
        }));
        asMock(prompts).mockImplementationOnce(() => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(exp, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });

      it(`asks the user to choose the account from his account list if he doesn't have access to the account defined in app.json / app.config.js`, async () => {
        asMock(prompts).mockImplementationOnce(() => ({
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
        asMock(prompts).mockImplementationOnce(() => ({
          account: user.accounts[0],
        }));

        const resolver = new AccountResolver(null, user);
        const account = await resolver.resolveAccountAsync();
        expect(account).toEqual(user.accounts[0]);
      });
    });
  });
});
