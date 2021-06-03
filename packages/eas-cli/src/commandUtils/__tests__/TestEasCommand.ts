import EasCommand from '../easCommand';

export default class TestEasCommand extends EasCommand {
  async run() {}
}

TestEasCommand.id = 'TestEasCommand'; // normally oclif will assign ids, but b/c this is located outside the commands folder it will not
