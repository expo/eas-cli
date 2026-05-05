import EasCommand, { ContextInput } from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';

/**
 * Shared context resolution for observe commands.
 *
 * If `projectIdOverride` is provided (typically via `--project-id`), the
 * helper only requires the LoggedIn context (so the command can run outside
 * of a project directory). Otherwise it uses the full context definition,
 * which derives the project ID from the local app config.
 */
export async function resolveObserveCommandContextAsync({
  command,
  commandClass,
  loggedInOnlyContextDefinition,
  projectIdOverride,
  nonInteractive,
}: {
  command: EasCommand;
  commandClass: { contextDefinition: ContextInput<any> };
  loggedInOnlyContextDefinition: ContextInput<any>;
  projectIdOverride?: string;
  nonInteractive: boolean;
}): Promise<{ projectId: string; graphqlClient: ExpoGraphqlClient }> {
  // `getContextAsync` is `protected` on EasCommand; cast to access from this helper.
  const commandWithContextAccess = command as unknown as {
    getContextAsync: (
      cls: { contextDefinition: ContextInput<any> },
      options: { nonInteractive: boolean }
    ) => Promise<any>;
  };

  if (projectIdOverride) {
    const ctx = await commandWithContextAccess.getContextAsync(
      { contextDefinition: loggedInOnlyContextDefinition },
      { nonInteractive }
    );
    return { projectId: projectIdOverride, graphqlClient: ctx.loggedIn.graphqlClient };
  }

  const ctx = await commandWithContextAccess.getContextAsync(commandClass, { nonInteractive });
  return { projectId: ctx.projectId, graphqlClient: ctx.loggedIn.graphqlClient };
}
