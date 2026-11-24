const nock = require('nock');

nock.disableNetConnect();
const accounts = ['creator', 'viewer'].map(name => ({
  id: name,
  name,
  viewerUserPermission2: {
    permissions: name === 'creator' ? ['PUBLISH'] : [],
    effectivePermissions: name === 'creator' ? ['PUBLISH'] : [],
  },
}));
nock('http://127.0.0.1:3000')
  .persist()
  .post('/graphql', body => body.query.includes('query CurrentUser'))
  .reply(200, {
    data: { meActor: { __typename: 'User', id: 'me', username: 'me', accounts } },
  });
