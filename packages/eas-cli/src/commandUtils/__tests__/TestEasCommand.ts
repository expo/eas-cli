import EasCommand from '../EasCommand';

export default class TestEasCommand extends EasCommand {
  requiresAuthentication = this.authValue();

  authValue() {
    return false;
  }

  async run() {}
}

TestEasCommand.id = 'TestEasCommand'; // normally oclif will assign ids, but b/c this is located outside the commands folder it will not
