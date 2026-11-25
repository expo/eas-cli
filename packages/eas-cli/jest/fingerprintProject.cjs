const nock = require('nock');

nock.disableNetConnect();

const api = nock('http://127.0.0.1:3000').persist();
api
  .post('/graphql', body => body.query.includes('query CurrentUser'))
  .reply(200, {
    data: { meActor: { __typename: 'User', id: 'me', username: 'fixture', accounts: [] } },
  });
api
  .post('/graphql', body => body.query.includes('query AppByIdQuery'))
  .reply(200, (_uri, body) => {
    if (process.env.EXPO_TOKEN === 'denied-token') {
      return {
        errors: [{ message: 'Fixture refusal', extensions: { errorCode: 'UNAUTHORIZED_ERROR' } }],
      };
    }
    return {
      data: {
        app: {
          byId: { id: body.variables.appId, slug: 'fixture', ownerAccount: { name: 'fixture' } },
        },
      },
    };
  });
api
  .post('/graphql', body => body.query.includes('query ViewUpdatesByGroup'))
  .reply(200, {
    data: { updatesByGroup: [{ id: 'ios-update' }, { id: 'android-update' }] },
  });
