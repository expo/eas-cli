import EasCommand from '../../commandUtils/EasCommand';

export default class WorkerDeploy extends EasCommand {
  static override description = 'deploy an Expo web build';
  static override aliases = ['deploy'];

  static override flags = {
    // TODO: Allow deployment identifier to be specified
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkerDeploy, {
      nonInteractive: true,
    });
  }
}
