import * as fs from 'fs';
import * as path from 'path';
import tempy from 'tempy';

import { getSessionSecret, loginAsync, logoutAsync } from '../accounts';

jest.mock('../utils/api', () => ({
  apiClient: {
    post: jest.fn(() => {
      return {
        json: () => Promise.resolve({ data: { sessionSecret: 'SESSION_SECRET' } }),
      };
    }),
  },
  graphqlClient: {
    query: () => {
      return {
        toPromise: () =>
          Promise.resolve({ data: { viewer: { id: 'USER_ID', username: 'USERNAME' } } }),
      };
    },
  },
}));

describe('loginAsync', () => {
  it('saves user data to ~/.expo/state.json', async () => {
    const HOME = tempy.directory({ prefix: 'expo-home-' });
    fs.mkdirSync(HOME, { recursive: true });
    process.env.__UNSAFE_EXPO_HOME_DIRECTORY = HOME;
    jest.resetModules();

    await loginAsync({ username: 'USERNAME', password: 'PASSWORD' });

    expect(fs.readFileSync(path.join(HOME, 'state.json'), 'utf8')).toMatchInlineSnapshot(`
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
    const HOME = tempy.directory({ prefix: 'expo-home-' });
    fs.mkdirSync(HOME, { recursive: true });
    process.env.__UNSAFE_EXPO_HOME_DIRECTORY = HOME;
    jest.resetModules();

    await loginAsync({ username: 'USERNAME', password: 'PASSWORD' });
    expect(getSessionSecret()).toBe('SESSION_SECRET');

    await logoutAsync();
    expect(getSessionSecret()).toBe(null);
  });
});
