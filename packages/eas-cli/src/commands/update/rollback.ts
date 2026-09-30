import { Args, Flags } from '@oclif/core';

import UpdateRepublish from './republish';
import UpdateRollBackToEmbedded from './roll-back-to-embedded';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import { promptAsync } from '../../prompts';

const defaultRollbackPlatforms = ['android', 'ios'] as const;

type SourceUpdateGroup = {
  groupId: string;
  branchName: string;
  runtimeVersion: string;
};

type PreviousUpdateGroup = {
  groupId: string;
  message: string | null;
};

export default class UpdateRollback extends EasCommand {
  static override description = 'roll back to an embedded update or an existing update';

  static override args = {
    groupId: Args.string({
      description:
        'The ID of the update group to roll back. Must be the latest update for its branch and runtime version. The update group published before it is republished; if there is none, a roll back to the embedded update is published. Required in non-interactive mode.',
      required: false,
    }),
  };

  static override flags = {
    message: Flags.string({
      char: 'm',
      description: 'Short message describing the rollback update',
      required: false,
    }),
    platform: Flags.option({
      char: 'p',
      options: [...defaultRollbackPlatforms, 'all'] as const,
      default: 'all',
      required: false,
    })(),
    'private-key-path': Flags.string({
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory. Only relevant if you are using code signing: https://docs.expo.dev/eas-update/code-signing/`,
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(UpdateRollback);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const groupId = args.groupId;
    const platform = flags.platform;
    const messageArg = flags.message;
    const privateKeyPathArg = flags['private-key-path']
      ? ['--private-key-path', flags['private-key-path']]
      : [];

    if (!groupId) {
      if (nonInteractive) {
        throw new Error('The update group ID argument is required in non-interactive mode.');
      }

      const { choice } = await promptAsync({
        type: 'select',
        message: 'Which type of update would you like to roll back to?',
        name: 'choice',
        choices: [
          { title: 'Published Update', value: 'published' },
          { title: 'Embedded Update', value: 'embedded' },
        ],
      });

      if (choice === 'published') {
        await UpdateRepublish.run(privateKeyPathArg);
      } else {
        await UpdateRollBackToEmbedded.run(privateKeyPathArg);
      }
      return;
    }

    const {
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId },
    } = await this.getContextAsync(UpdateRollback, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const sourceGroup = await getSourceUpdateGroupAsync(graphqlClient, groupId);
    const previousGroup = await getPreviousUpdateGroupAsync(graphqlClient, projectId, sourceGroup);

    const commonArgs = [
      '--non-interactive',
      '--platform',
      platform,
      ...privateKeyPathArg,
      ...(json ? ['--json'] : []),
    ];

    if (previousGroup) {
      const message =
        messageArg ??
        `Roll back to "${previousGroup.message ?? ''}" (group: ${previousGroup.groupId})`;
      await UpdateRepublish.run([
        '--group',
        previousGroup.groupId,
        '--message',
        message,
        ...commonArgs,
      ]);
    } else {
      const message = messageArg ?? 'Roll back to embedded';
      await UpdateRollBackToEmbedded.run([
        '--branch',
        sourceGroup.branchName,
        '--runtime-version',
        sourceGroup.runtimeVersion,
        '--message',
        message,
        ...commonArgs,
      ]);
    }
  }
}

async function getSourceUpdateGroupAsync(
  graphqlClient: ExpoGraphqlClient,
  groupId: string
): Promise<SourceUpdateGroup> {
  // viewUpdateGroupAsync throws if no updates are found for the group ID.
  const updateGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, { groupId });
  const arbitraryUpdate = updateGroup[0];
  return {
    groupId,
    branchName: arbitraryUpdate.branch.name,
    runtimeVersion: arbitraryUpdate.runtime.version,
  };
}

async function getPreviousUpdateGroupAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  sourceGroup: SourceUpdateGroup
): Promise<PreviousUpdateGroup | null> {
  // Clients on a given runtime version are served the latest update group on the branch,
  // so a rollback is only meaningful when the source group is that latest group. Fetch the
  // two most recent groups for the runtime version (returned most-recent-first): the first
  // must be the source group, and the second (if any) is the update to roll back to.
  const latestGroups = await UpdateQuery.viewUpdateGroupsPaginatedOnBranchAsync(graphqlClient, {
    appId: projectId,
    branchName: sourceGroup.branchName,
    first: 2,
    filter: { runtimeVersions: [sourceGroup.runtimeVersion] },
  });

  const latestGroup = latestGroups[0];
  if (!latestGroup?.length || latestGroup[0].group !== sourceGroup.groupId) {
    throw new Error(
      `Update group "${sourceGroup.groupId}" is not the latest update on branch "${
        sourceGroup.branchName
      }" for runtime version "${sourceGroup.runtimeVersion}"${
        latestGroup?.length ? ` (the latest is "${latestGroup[0].group}")` : ''
      }. Only the latest update can be rolled back.`
    );
  }

  // Source group is the only update for this runtime version: roll back to embedded.
  const previousGroup = latestGroups[1];
  if (!previousGroup?.length) {
    return null;
  }

  return { groupId: previousGroup[0].group, message: previousGroup[0].message ?? null };
}
