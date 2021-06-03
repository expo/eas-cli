import AuthenticatedCommand from '../authenticatedCommand';

export default class TestAuthenticatedCommand extends AuthenticatedCommand {
  async run() {}
}

TestAuthenticatedCommand.id = 'TestAuthenticatedCommand'; // normally oclif will assign ids, but b/c this is located outside the commands folder it will not
