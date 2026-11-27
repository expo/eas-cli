// Replace the API in the CLI subprocess so the command runs against local responses.
const nock = require('nock');
nock.disableNetConnect();

const app = { id: 'app-123', slug: 'testapp', ownerAccount: { name: 'testuser' } };
const session = { id: 'session-123', app, status: 'IN_PROGRESS', turtleJobRun: { id: 'job-123' } };
const actor = {
  __typename: 'User',
  id: 'user',
  username: 'testuser',
  isExpoAdmin: true,
  accounts: [],
};
const scenario = process.env.FIXTURE_SCENARIO;

nock('http://127.0.0.1:3000')
  .persist()
  .post('/graphql')
  .reply(200, (_uri, body) => {
    switch (body.operationName) {
      case 'CurrentUser':
        if (scenario === 'auth-error') {
          return { errors: [{ message: 'fixture auth error' }] };
        }
        return { data: { meActor: actor } };
      case 'AppByIdQuery':
        return { data: { app: { byId: app } } };
      case 'StatuspageServiceByServiceNamesQuery':
        return { data: { statuspageService: { byServiceNames: [] } } };
      case 'CreateDeviceRunSessionMutation':
        if (scenario === 'create-error') {
          return { errors: [{ message: 'fixture create error' }] };
        }
        return {
          data: {
            deviceRunSession: {
              createDeviceRunSession:
                scenario === 'missing-job' ? { ...session, turtleJobRun: null } : session,
            },
          },
        };
      case 'DeviceRunSessionByIdQuery': {
        // Same pipe as lifecycle events so the parent can check ordering across the process boundary.
        process.stderr.write('fixture: polling readiness\n');
        if (scenario === 'errored') {
          return { data: { deviceRunSessions: { byId: { ...session, status: 'ERRORED' } } } };
        }
        if (scenario !== 'ready') {
          return { errors: [{ message: 'fixture readiness error' }] };
        }
        const remoteConfig = {
          __typename: 'AgentDeviceRunSessionRemoteConfig',
          agentDeviceRemoteSessionUrl: 'https://agent.example.com',
          agentDeviceRemoteSessionToken: 'fixture-token',
        };
        return { data: { deviceRunSessions: { byId: { ...session, remoteConfig } } } };
      }
      case 'EnsureDeviceRunSessionStoppedMutation': {
        if (scenario === 'stop-error') {
          return { errors: [{ message: 'fixture stop error' }] };
        }
        const stop = {
          id: session.id,
          status: scenario === 'errored' ? 'ERRORED' : scenario === 'still-running' ? 'IN_PROGRESS' : 'STOPPED',
        };
        return { data: { deviceRunSession: { ensureDeviceRunSessionStopped: stop } } };
      }
      default:
        return { errors: [{ message: 'Unexpected fixture query: ' + body.operationName }] };
    }
  });
