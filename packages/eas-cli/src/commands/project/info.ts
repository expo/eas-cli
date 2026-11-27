import EasCommand from '../../commandUtils/EasCommand';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';

export default class ProjectInfo extends EasCommand {
  static override description = 'information about the current project';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectInfo, {
      nonInteractive: true,
    });

    const [app, iconUrl] = await Promise.all([
      AppQuery.byIdAsync(graphqlClient, projectId),
      AppQuery.byIdProfileImageUrlAsync(graphqlClient, projectId),
    ]);

    Log.addNewLineIfNone();
    Log.log(
      formatFields([
        { label: 'fullName', value: app.fullName },
        { label: 'name', value: app.name },
        { label: 'slug', value: app.slug },
        { label: 'icon', value: iconUrl ?? 'not set' },
        { label: 'ID', value: projectId },
      ])
    );
  }
}
