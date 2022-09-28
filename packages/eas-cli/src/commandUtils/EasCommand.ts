import { Command } from '@oclif/core';

import {
  AnalyticsEvent,
  flushAsync as flushAnalyticsAsync,
  initAsync as initAnalyticsAsync,
  logEvent,
} from '../analytics/rudderstackClient';
import { getUserAsync } from '../user/User';
import ActorContextField from './context/ActorContextField';
import ContextField from './context/ContextField';
import { DynamicProjectConfigContextField } from './context/DynamicProjectConfigContextField';
import { OptionalProjectConfigContextField } from './context/OptionalProjectConfigContextField';
import ProjectConfigContextField from './context/ProjectConfigContextField';
import ProjectDirContextField from './context/ProjectDirContextField';

export const EASCommandProjectConfigContext = {
  projectConfig: new ProjectConfigContextField(),
};

export const EASCommandDynamicProjectConfigContext = {
  // eslint-disable-next-line async-protect/async-suffix
  getDynamicProjectConfigAsync: new DynamicProjectConfigContextField(),
};

export const EASCommandProjectDirContext = {
  projectDir: new ProjectDirContextField(),
};

export const EASCommandOptionalProjectConfigContext = {
  projectConfig: new OptionalProjectConfigContextField(),
};

export const EASCommandLoggedInContext = {
  actor: new ActorContextField(),
};

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
  static contextDefinition: ContextInput = {};

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
        return [contextKey, await contextDefinition[contextKey].getValueAsync({ nonInteractive })];
      })
    );

    return Object.fromEntries(contextValuePairs);
  }

  protected abstract runAsync(): Promise<any>;

  // eslint-disable-next-line async-protect/async-suffix
  async run(): Promise<any> {
    await initAnalyticsAsync();

    // this is needed for logEvent call below as it identifies the user in the analytics system
    await getUserAsync();
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
