// Offline demo only. Loaded before the real CLI in each fresh child process.
const os = require('os');
os.homedir = () => process.env.EAS_DEVICE_DEMO_DIRECTORY;

const nock = require('nock');
const MockDate = require('mockdate');
const phase = process.env.EAS_DEVICE_DEMO_PHASE;
MockDate.set(Number(process.env.EAS_DEVICE_DEMO_TIME));
nock.disableNetConnect();
nock('http://127.0.0.1:3000')
  .post('/v2/auth/device_authorization', body => body.client_id === 'eas-cli')
  .reply(200, { data: {
    device_code: 'DEMO_PRIVATE_DEVICE_CODE',
    user_code: 'BCDF-GHJK',
    verification_uri: 'https://example.invalid/oauth/device',
    expires_in: 600,
    interval: 5,
  } });
nock('http://127.0.0.1:3000')
  .post('/v2/auth/token', body => {
    if (phase === 'finish' || phase === 'denied') {
      return body.match_value === (phase === 'finish' ? '42' : '12');
    }
    return body.match_value === undefined;
  })
  .reply(200, { data: phase === 'finish'
    ? { session_secret: 'DEMO_PRIVATE_SESSION', expires_at: '2099-01-01T00:00:00Z' }
    : phase === 'matching'
      ? { error: 'matching_required', match_options: ['12', '42', '87'] }
      : { error: phase === 'denied' ? 'access_denied' : 'authorization_pending' }
  });
nock('http://127.0.0.1:3000')
  .post('/graphql')
  .reply(200, { data: { meUserActor: { __typename: 'User', id: 'demo-user-id', username: 'demo-user' } } });
