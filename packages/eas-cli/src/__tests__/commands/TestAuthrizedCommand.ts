import AuthorizedCommand from '../../commands/abstract/authorizedCommand';

// Kirby - cannot be in the commands folder or oclif will pick it up as a valid command, prepack + test will fail
// seems there is some pattern to exclude https://github.com/oclif/config/blob/master/src/plugin.ts#L230 but i couldn't get it to work
export default class TestAuthrizedCommand extends AuthorizedCommand {
  async run() {}
}
