import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';

export default class New extends EasCommand {
  static override aliases = ['new'];

  static override description = "create a new project set up with Expo's services.";

  static override flags = {};

  static override args = [{ name: 'TARGET_PROJECT_DIRECTORY' }];

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
  };

  async runAsync(): Promise<void> {
    const {
      args: { TARGET_PROJECT_DIRECTORY: targetProjectDirInput },
    } = await this.parse(New);

    const {
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(New, {
      nonInteractive: false,
    });

    if (actor.__typename === 'Robot') {
      throw new Error(
        'This command is not available for robot users. Make sure you are not using a robot token and try again.'
      );
    }

    Log.log(`👋 Welcome to Expo, ${actor.username}!`);
  }
}
