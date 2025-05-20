import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';

export type WorkflowResult = {
  id: string;
  name?: string | null | undefined;
  fileName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export default class ProjectWorkflowList extends EasCommand {
  static override description = 'List workflows for the current project';

  static override flags = {
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ProjectWorkflowList);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectWorkflowList, {
      nonInteractive: true,
    });

    const byId = await AppQuery.byIdWorkflowsAsync(graphqlClient, projectId);
    if (!byId) {
      throw new Error(`Could not find project with id: ${projectId}`);
    }

    const result: WorkflowResult[] = byId.workflows.map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      fileName: workflow.fileName,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    }));

    if (flags.json) {
      Log.log(JSON.stringify(result, null, 2));
      return;
    }

    Log.addNewLineIfNone();
    result.forEach(workflow => {
      Log.log(
        formatFields([
          { label: 'ID', value: workflow.id },
          { label: 'Name', value: workflow.name ?? 'null' },
          { label: 'File name', value: workflow.fileName ?? 'null' },
          { label: 'Created At', value: workflow.createdAt ?? 'null' },
          { label: 'Updated At', value: workflow.updatedAt ?? 'null' },
        ])
      );
      Log.addNewLineIfNone();
    });
  }
}
