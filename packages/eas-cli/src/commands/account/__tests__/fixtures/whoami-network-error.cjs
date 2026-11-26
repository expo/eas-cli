const { Config, Errors } = require('@oclif/core');
const { CombinedError } = require('@urql/core');
const SessionManager = require('../../../../user/SessionManager').default;
const AccountView = require('../../view').default;

// Model a transport failure even when the response also carries an authentication error.
SessionManager.prototype.getUserAsync = async () => {
  throw new CombinedError({
    networkError: new Error('connection reset'),
    graphQLErrors: [{ message: 'Rejected credential', code: 'AUTHENTICATION_ERROR' }],
  });
};

// The command under test is already loaded. Skip installed plugins and their update checks.
const config = new Config({ root: process.cwd() });
config.runHook = async () => ({ successes: [], failures: [] });
AccountView.run(['--json'], config).catch(Errors.handle);
