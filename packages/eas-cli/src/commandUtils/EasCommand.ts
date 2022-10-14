import { Command } from '@oclif/core';

import {
  AnalyticsEvent,
  flushAsync as flushAnalyticsAsync,
  initAsync as initAnalyticsAsync,
  logEvent,
} from '../analytics/rudderstackClient';
import SessionManager from '../user/SessionManager';
import ContextField from './context/ContextField';
import { DynamicProjectConfigContextField } from './context/DynamicProjectConfigContextField';
import LoggedInContextField from './context/LoggedInContextField';
import MaybeLoggedInContextField from './context/MaybeLoggedInContextField';
import { OptionalProjectConfigContextField } from './context/OptionalProjectConfigContextField';
import ProjectConfigContextField from './context/ProjectConfigContextField';
import ProjectDirContextField from './context/ProjectDirContextField';
import SessionManagementContextField from './context/SessionManagementContextField';

type ContextInput<
  T extends {
    [name: string]: any;
  } = object
> = {
  [P in keyof T]: ContextField<T[P]>;
};

type ContextOutput<
  T extends {
    [name: string]: any;
  } = object
> = {
  [P in keyof T]: T[P];
};

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
      projectConfig: new OptionalProjectConfigContextField(),
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
      getDynamicProjectConfigAsync: new DynamicProjectConfigContextField(),
    },
    /**
     * Require the project to be identified and registered on server. Returns the project config in the context.
     */
    ProjectConfig: {
      projectConfig: new ProjectConfigContextField(),
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
   * Execute the context in the contextDefinition to satisfy command prerequisites.
   */
  protected async getContextAsync<
    C extends {
      [name: string]: any;
    } = object
  >(
    commandClass: { contextDefinition: ContextInput<C> },
    { nonInteractive }: { nonInteractive: boolean }
  ): Promise<ContextOutput<C>> {
    const contextDefinition = commandClass.contextDefinition;

    const contextValuePairs = await Promise.all(
      Object.keys(contextDefinition).map(async contextKey => {
        return [
          contextKey,
          await contextDefinition[contextKey].getValueAsync({
            nonInteractive,
            sessionManager: this.sessionManager,
          }),
        ];
      })
    );

    return Object.fromEntries(contextValuePairs);
  }

  /**
   * The user session manager. Responsible for coordinating all user session related state.
   * If needed in a subclass, SessionManager ContextOption.
   */
  private readonly sessionManager = new SessionManager();

  protected abstract runAsync(): Promise<any>;

  // eslint-disable-next-line async-protect/async-suffix
  async run(): Promise<any> {
    await initAnalyticsAsync();

    // this is needed for logEvent call below as it identifies the user in the analytics system
    await this.sessionManager.getUserAsync();

    logEvent(AnalyticsEvent.ACTION, {
      // id is assigned by oclif in constructor based on the filepath:
      // commands/submit === submit, commands/build/list === build:list
      action: `eas ${this.id}`,
    });

    return this.runAsync();
  }

  // eslint-disable-next-line async-protect/async-suffix
  override async finally(err: Error): Promise<any> {
    await flushAnalyticsAsync();
    return super.finally(err);
  }
}
