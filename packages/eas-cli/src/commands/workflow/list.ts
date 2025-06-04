import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

type WorkflowResult = {
  id: string;
  name?: string | null | undefined;
  fileName: string;
  createdAt: string;
  updatedAt: string;
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
    if (flags.json) {
      enableJsonOutput();
    }

    const workflows = await AppQuery.byIdWorkflowsAsync(graphqlClient, projectId);

    const result: WorkflowResult[] = workflows.map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      fileName: workflow.fileName,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    }));

    if (flags.json) {
      printJsonOnlyOutput(result);
      return;
    }

    Log.addNewLineIfNone();
    result.forEach(workflow => {
      Log.log(
        formatFields([
          { label: 'ID', value: workflow.id },
          { label: 'Name', value: workflow.name ?? '-' },
          { label: 'File name', value: workflow.fileName },
          { label: 'Created At', value: workflow.createdAt },
          { label: 'Updated At', value: workflow.updatedAt },
        ])
      );
      Log.addNewLineIfNone();
    });
  }
}
