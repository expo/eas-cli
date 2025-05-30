import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export type WorkflowResult = {
  id: string | null;
  name?: string | null | undefined;
  fileName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export default class WorkflowList extends EasCommand {
  static override description = 'List workflows for the current project';

  static override flags = {
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WorkflowList);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowList, {
      nonInteractive: true,
    });

    const workflows = await AppQuery.byIdWorkflowsAsync(graphqlClient, projectId);

    const result: WorkflowResult[] = workflows.map(workflow => ({
      id: workflow.id ?? null,
      name: workflow.name ?? null,
      fileName: workflow.fileName ?? null,
      createdAt: workflow.createdAt ?? null,
      updatedAt: workflow.updatedAt ?? null,
    }));

    if (flags.json) {
      enableJsonOutput();
      printJsonOnlyOutput(result);
      return;
    }

    Log.addNewLineIfNone();
    result.forEach(workflow => {
      Log.log(
        formatFields([
          { label: 'ID', value: workflow.id ?? '-' },
          { label: 'Name', value: workflow.name ?? '-' },
          { label: 'File name', value: workflow.fileName ?? '-' },
          { label: 'Created At', value: workflow.createdAt ?? '-' },
          { label: 'Updated At', value: workflow.updatedAt ?? '-' },
        ])
      );
      Log.addNewLineIfNone();
    });
  }
}
