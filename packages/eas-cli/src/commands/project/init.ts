import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import {
  ensureOwnerSlugConsistencyAsync,
  initializeWithExplicitIDAsync,
  initializeWithoutExplicitIDAsync,
} from '../../project/projectInitialization';

export default class ProjectInit extends EasCommand {
  static override description = 'create or link an EAS project';
  static override aliases = ['init'];

  static override flags = {
    id: Flags.string({
      description: 'ID of the EAS project to link',
    }),
    account: Flags.string({
      description: 'Name of the account that will own the project',
      exclusive: ['id'],
    }),
    force: Flags.boolean({
      description:
        'Whether to create a new project/link an existing project without additional prompts or overwrite any existing project ID when running with --id flag',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { id: idArgument, account: accountArgument, force, 'non-interactive': nonInteractive },
    } = await this.parse(ProjectInit);
    const {
      loggedIn: { actor, graphqlClient },
      projectDir,
    } = await this.getContextAsync(ProjectInit, { nonInteractive });

    let idForConsistency: string;
    if (idArgument) {
      await initializeWithExplicitIDAsync(idArgument, projectDir, {
        force,
        nonInteractive,
      });
      idForConsistency = idArgument;
    } else {
      idForConsistency = await initializeWithoutExplicitIDAsync(graphqlClient, actor, projectDir, {
        force,
        nonInteractive,
        accountName: accountArgument,
      });
    }

    await ensureOwnerSlugConsistencyAsync(graphqlClient, idForConsistency, projectDir, {
      force,
      nonInteractive,
    });
  }
}
