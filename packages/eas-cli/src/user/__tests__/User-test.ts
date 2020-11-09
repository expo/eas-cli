import fs from 'fs-extra';
import { vol } from 'memfs';

import { getStateJsonPath } from '../../utils/paths';
import { getSessionSecret, loginAsync, logoutAsync } from '../User';

jest.mock('fs');
jest.mock('../../api', () => ({
  apiClient: {
    post: jest.fn(() => {
      return {
        json: () => Promise.resolve({ data: { sessionSecret: 'SESSION_SECRET' } }),
      };
    }),
  },
}));
jest.mock('../../graphql/client', () => ({
  graphqlClient: {
    query: () => {
      return {
        toPromise: () =>
          Promise.resolve({ data: { viewer: { id: 'USER_ID', username: 'USERNAME' } } }),
      };
    },
  },
}));

beforeEach(() => {
  vol.reset();
});

describe('loginAsync', () => {
  it('saves user data to ~/.expo/state.json', async () => {
    await loginAsync({ username: 'USERNAME', password: 'PASSWORD' });

    expect(await fs.readFile(getStateJsonPath(), 'utf8')).toMatchInlineSnapshot(`
      "{
        \\"auth\\": {
          \\"sessionSecret\\": \\"SESSION_SECRET\\",
          \\"userId\\": \\"USER_ID\\",
          \\"username\\": \\"USERNAME\\",
          \\"currentConnection\\": \\"Username-Password-Authentication\\"
        }
      }
      "
    `);
  });
});

describe('logoutAsync', () => {
  it('removes the session secret', async () => {
    await loginAsync({ username: 'USERNAME', password: 'PASSWORD' });
    expect(getSessionSecret()).toBe('SESSION_SECRET');

    await logoutAsync();
    expect(getSessionSecret()).toBe(null);
  });
});
