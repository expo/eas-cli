import EasCommand from '../EasCommand';

export default class TestEasCommand extends EasCommand {
  requiresAuthentication = this.authValue();

  authValue(): boolean {
    return false;
  }

  async run(): Promise<void> {}
}

TestEasCommand.id = 'TestEasCommand'; // normally oclif will assign ids, but b/c this is located outside the commands folder it will not
