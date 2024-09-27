import { Command } from '@oclif/core';
import { CombinedError } from '@urql/core';
import chalk from 'chalk';
import { GraphQLError } from 'graphql/error';
import nullthrows from 'nullthrows';

import AnalyticsContextField from './context/AnalyticsContextField';
import ContextField from './context/ContextField';
import {
  DynamicPrivateProjectConfigContextField,
  DynamicPublicProjectConfigContextField,
} from './context/DynamicProjectConfigContextField';
import LoggedInContextField from './context/LoggedInContextField';
import MaybeLoggedInContextField from './context/MaybeLoggedInContextField';
import { OptionalPrivateProjectConfigContextField } from './context/OptionalPrivateProjectConfigContextField';
import { PrivateProjectConfigContextField } from './context/PrivateProjectConfigContextField';
import ProjectDirContextField from './context/ProjectDirContextField';
import SessionManagementContextField from './context/SessionManagementContextField';
import VcsClientContextField from './context/VcsClientContextField';
import { EasCommandError } from './errors';
import {
  AnalyticsWithOrchestration,
  CommandEvent,
  createAnalyticsAsync,
} from '../analytics/AnalyticsManager';
import Log from '../log';
import SessionManager from '../user/SessionManager';
import { Client } from '../vcs/vcs';

export type ContextInput<
  T extends {
    [name: string]: any;
  } = object,
> = {
  [P in keyof T]: ContextField<T[P]>;
};

export type ContextOutput<
  T extends {
    [name: string]: any;
  } = object,
> = {
  [P in keyof T]: T[P];
};

const BASE_GRAPHQL_ERROR_MESSAGE: string = 'GraphQL request failed.';

export default abstract class EasCommand extends Command {
  protected static readonly ContextOptions = {
    /**
     * Require this command to be run when logged-in. Returns the logged-in actor and a logged-in
     * graphql client in the context.
     */
    LoggedIn: {
      loggedIn: new LoggedInContextField(),
    },
    /**
     * Do not require this command to be run when logged-in, but if it is get the logged-in actor and a
     * maybe-logged-in graphql client.
     */
    MaybeLoggedIn: {
      maybeLoggedIn: new MaybeLoggedInContextField(),
    },
    /**
     * Specify this context requirement if the command needs to mutate the user session.
     */
    SessionManagment: {
      sessionManager: new SessionManagementContextField(),
    },
    /**
     * Require the project to be identified and registered on server if this command is being
     * run within a project directory, null otherwise.
     */
    OptionalProjectConfig: {
      privateProjectConfig: new OptionalPrivateProjectConfigContextField(),
    },
    /**
     * Require this command to be run in a project directory. Return the project directory in the context.
     */
    ProjectDir: {
      projectDir: new ProjectDirContextField(),
    },
    /**
     * Provides functions to load the project config when dynamic config options are needed (custom Env for example).
     */
    DynamicProjectConfig: {
      // eslint-disable-next-line async-protect/async-suffix
      getDynamicPublicProjectConfigAsync: new DynamicPublicProjectConfigContextField(),
      // eslint-disable-next-line async-protect/async-suffix
      getDynamicPrivateProjectConfigAsync: new DynamicPrivateProjectConfigContextField(),
    },
    /**
     * Require the project to be identified and registered on server. Returns the project config in the context.
     * This also requires the user to be logged in (getProjectIdAsync requires logged in), so also expose that context.
     * Exposing the loggedIn context here helps us guarantee user identification for logging purposes.
     */
    ProjectConfig: {
      loggedIn: new LoggedInContextField(),
      privateProjectConfig: new PrivateProjectConfigContextField(),
    },
    /**
     * Analytics manager. Returns the analytics manager in the context for use by the command.
     */
    Analytics: {
      analytics: new AnalyticsContextField(),
    },
    Vcs: {
      vcsClient: new VcsClientContextField(),
    },
  };

  /**
   * Context allows for subclasses (commands) to declare their prerequisites in a type-safe manner.
   * These declarative definitions each output a context property that is the result of the prerequisite being
   * satisfied. These allow a unified common interface to be shared amongst commands in order to provide a more
   * consistent CLI experience.
   *
   * For example, let's say a command needs the EAS project ID to make a GraphQL mutation. It should declare that
   * it requires the `ProjectConfig` context, and then call `getContextAsync` to get the project ID.
   */
  static contextDefinition: ContextInput = {};

  /**
   * The user session manager. Responsible for coordinating all user session related state.
   * If needed in a subclass, use the SessionManager ContextOption.
   */
  private sessionManagerInternal?: SessionManager;

  /**
   * The analytics manager. Used for logging analytics.
   * It is set up here to ensure a consistent setup.
   */
  private analyticsInternal?: AnalyticsWithOrchestration;

  /**
   * Execute the context in the contextDefinition to satisfy command prerequisites.
   */
  protected async getContextAsync<
    C extends {
      [name: string]: any;
    } = object,
  >(
    commandClass: { contextDefinition: ContextInput<C> },
    { nonInteractive, vcsClientOverride }: { nonInteractive: boolean; vcsClientOverride?: Client }
  ): Promise<ContextOutput<C>> {
    const contextDefinition = commandClass.contextDefinition;

    // do these serially so that they don't do things like ask for login twice in parallel
    const contextValuePairs = [];
    for (const [contextKey, contextField] of Object.entries(contextDefinition)) {
      contextValuePairs.push([
        contextKey,
        await contextField.getValueAsync({
          nonInteractive,
          sessionManager: this.sessionManager,
          analytics: this.analytics,
          vcsClientOverride,
        }),
      ]);
    }

    return Object.fromEntries(contextValuePairs);
  }

  private get sessionManager(): SessionManager {
    return nullthrows(this.sessionManagerInternal);
  }

  private get analytics(): AnalyticsWithOrchestration {
    return nullthrows(this.analyticsInternal);
  }

  protected abstract runAsync(): Promise<any>;

  // eslint-disable-next-line async-protect/async-suffix
  async run(): Promise<any> {
    this.analyticsInternal = await createAnalyticsAsync();
    this.sessionManagerInternal = new SessionManager(this.analytics);

    // this is needed for logEvent call below as it identifies the user in the analytics system
    // if possible
    await this.sessionManager.getUserAsync();

    this.analytics.logEvent(CommandEvent.ACTION, {
      // id is assigned by oclif in constructor based on the filepath:
      // commands/submit === submit, commands/build/list === build:list
      action: `eas ${this.id}`,
    });

    return await this.runAsync();
  }

  // eslint-disable-next-line async-protect/async-suffix
  override async finally(err: Error): Promise<any> {
    await this.analytics.flushAsync();
    return await super.finally(err);
  }

  protected override catch(err: Error): Promise<any> {
    let baseMessage = `${this.id} command failed.`;
    if (err instanceof EasCommandError) {
      Log.error(err.message);
    } else if (err instanceof CombinedError && err?.graphQLErrors) {
      const cleanGQLErrorsMessage = err?.graphQLErrors
        .map((graphQLError: GraphQLError) => {
          const messageLine = graphQLError.message.replace('[GraphQL] ', '');
          const requestIdLine = graphQLError.extensions?.requestId
            ? `\nRequest ID: ${err.graphQLErrors[0].extensions.requestId}`
            : '';

          const defaultMsg = `${messageLine}${requestIdLine}`;

          if (graphQLError.extensions?.errorCode === 'UNAUTHORIZED_ERROR') {
            return `${chalk.bold(
              `You don't have the required permissions to perform this operation.`
            )}\n\nThis can sometimes happen if you are logged in as incorrect user.\nRun ${chalk.bold(
              'eas whoami'
            )} to check the username you are logged in as.\nRun ${chalk.bold(
              'eas login'
            )} to change the account.\n\nOriginal error message: ${defaultMsg}`;
          }

          return defaultMsg;
        })
        .join('\n');
      const cleanMessage = err.networkError
        ? `${cleanGQLErrorsMessage}\n${err.networkError.message}`
        : cleanGQLErrorsMessage;
      Log.error(cleanMessage);
      baseMessage = BASE_GRAPHQL_ERROR_MESSAGE;
    } else {
      Log.error(err.message);
    }
    Log.debug(err);
    const sanitizedError = new Error(baseMessage);
    sanitizedError.stack = err.stack;
    throw sanitizedError;
  }
}
