import { Session } from '@expo/apple-utils';
import nock from 'nock';

import { createAppAsync } from '../ensureAppExists';

const FIXTURE_SUCCESS = {
  data: {
    type: 'apps',
    id: '6741087677',
    attributes: {
      name: 'expo (xxx)',
      bundleId: 'com.bacon.jan27.x',
    },
  },
};

const FIXTURE_INVALID_NAME = {
  errors: [
    {
      id: 'b3e7ca18-e4ce-4e55-83ce-8fff35dbaeca',
      status: '409',
      code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_CHARACTERS',
      title: 'An attribute value has invalid characters.',
      detail:
        'App Name contains certain Unicode symbols, emoticons, diacritics, special characters, or private use characters that are not permitted.',
      source: {
        pointer: '/included/1/name',
      },
    },
  ],
};

const FIXTURE_ALREADY_USED_ON_ACCOUNT = {
  errors: [
    {
      id: 'b91aefc5-0e94-48d9-8613-5b1a464a20f0',
      status: '409',
      code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE.SAME_ACCOUNT',
      title:
        'The provided entity includes an attribute with a value that has already been used on this account.',
      detail:
        'The app name you entered is already being used for another app in your account. If you would like to use the name for this app you will need to submit an update to your other app to change the name, or remove it from App Store Connect.',
      source: {
        pointer: '/included/1/name',
      },
    },
  ],
};

const FIXTURE_ALREADY_USED_ON_ANOTHER_ACCOUNT = {
  errors: [
    {
      id: '72b960f2-9e51-4f19-8d83-7cc08d42fec4',
      status: '409',
      code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE.DIFFERENT_ACCOUNT',
      title:
        'The provided entity includes an attribute with a value that has already been used on a different account.',
      detail:
        'The App Name you entered is already being used. If you have trademark rights to this name and would like it released for your use, submit a claim.',
      source: {
        pointer: '/included/1/name',
      },
    },
  ],
};

const MOCK_CONTEXT = {
  providerId: 1337,
  teamId: 'test-team-id',
  token: 'test-token',
};

beforeAll(async () => {
  // Mock setup cookies API calls.
  nock('https://appstoreconnect.apple.com')
    .get(`/olympus/v1/session`)
    .reply(200, {
      provider: {
        providerId: 1337,
        publicProviderId: 'xxx-xxx-xxx-xxx-xxx',
        name: 'Evan Bacon',
        contentTypes: ['SOFTWARE'],
        subType: 'INDIVIDUAL',
      },
    });

  await Session.fetchCurrentSessionInfoAsync();
});

function getNameFromBody(body: any): any {
  return body.included.find((item: any) => item.id === '${new-appInfoLocalization-id}')?.attributes
    ?.name;
}

it('asserts invalid name cases', async () => {
  const scope = nock('https://appstoreconnect.apple.com')
    .post(`/iris/v1/apps`, body => {
      expect(getNameFromBody(body)).toBe('Expo 🚀');

      return true;
    })
    .reply(409, FIXTURE_INVALID_NAME);

  // Already used on same account
  nock('https://appstoreconnect.apple.com')
    .post(`/iris/v1/apps`, body => {
      expect(getNameFromBody(body)).toBe('Expo -');
      return true;
    })
    .reply(409, FIXTURE_ALREADY_USED_ON_ACCOUNT);

  // Already used on different account
  nock('https://appstoreconnect.apple.com')
    .post(`/iris/v1/apps`, body => {
      expect(getNameFromBody(body)).toMatch(/Expo - \([\w\d]+\)/);
      return true;
    })
    .reply(409, FIXTURE_ALREADY_USED_ON_ANOTHER_ACCOUNT);

  // Success
  nock('https://appstoreconnect.apple.com')
    .post(`/iris/v1/apps`, body => {
      expect(getNameFromBody(body)).toMatch(/Expo - \([\w\d]+\)/);
      return true;
    })
    .reply(200, FIXTURE_SUCCESS);

  await createAppAsync(MOCK_CONTEXT, {
    bundleId: 'com.bacon.jan27.x',
    name: 'Expo 🚀',
    companyName: 'expo',
  });

  expect(scope.isDone()).toBeTruthy();
});

it('works on first try', async () => {
  nock('https://appstoreconnect.apple.com').post(`/iris/v1/apps`).reply(200, FIXTURE_SUCCESS);

  await createAppAsync(MOCK_CONTEXT, {
    bundleId: 'com.bacon.jan27.x',
    name: 'Expo',
    companyName: 'expo',
  });
});

it('doubles up entropy', async () => {
  nock('https://appstoreconnect.apple.com')
    .post(`/iris/v1/apps`)
    .reply(409, FIXTURE_ALREADY_USED_ON_ANOTHER_ACCOUNT);

  nock('https://appstoreconnect.apple.com')
    .post(`/iris/v1/apps`)
    .reply(409, FIXTURE_ALREADY_USED_ON_ANOTHER_ACCOUNT);

  nock('https://appstoreconnect.apple.com')
    .post(`/iris/v1/apps`, body => {
      expect(getNameFromBody(body)).toMatch(/Expo \([\w\d]+\) \([\w\d]+\)/);
      return true;
    })
    .reply(200, FIXTURE_SUCCESS);

  await createAppAsync(MOCK_CONTEXT, {
    bundleId: 'com.bacon.jan27.x',
    name: 'Expo',
    companyName: 'expo',
  });
});
