import invariant from 'invariant';

import prompt, { ChoiceType, Question } from '../../prompt';
import { confirmAsync } from '../../prompts';
import { displayAndroidCredentials, displayIosCredentials } from '../actions/list';
import { AppLookupParams } from '../api/IosApi';
import { Context, IView } from '../context';
import { CredentialsManager } from '../route';
import * as androidView from './AndroidCredentials';
import * as iosDistView from './IosDistCert';
import * as iosProvisionigProfileView from './IosProvisioningProfile';
import * as iosPushView from './IosPushCredentials';

export class SelectPlatform implements IView {
  async open(ctx: Context): Promise<IView | null> {
    const { platform } = await prompt([
      {
        type: 'list',
        name: 'platform',
        message: 'Select platform',
        pageSize: Infinity,
        choices: ['ios', 'android'],
      },
    ]);
    const view = platform === 'ios' ? new SelectIosExperience() : new SelectAndroidExperience();
    CredentialsManager.get().changeMainView(view);
    return view;
  }
}

export class SelectIosExperience implements IView {
  async open(ctx: Context): Promise<IView | null> {
    return null;
  }
}

export class SelectAndroidExperience implements IView {
  private askAboutProjectMode = true;

  async open(ctx: Context): Promise<IView | null> {
    if (ctx.hasProjectContext && this.askAboutProjectMode) {
      const experienceName = `@${ctx.manifest.owner || ctx.user.username}/${ctx.manifest.slug}`;

      const runProjectContext = await confirmAsync({
        message: `You are currently in a directory with ${experienceName} experience. Do you want to select it?`,
      });

      if (runProjectContext) {
        invariant(ctx.manifest.slug, 'app.json slug field must be set');
        const view = new androidView.ExperienceView(experienceName);
        CredentialsManager.get().changeMainView(view);
        return view;
      }
    }
    this.askAboutProjectMode = false;

    const credentials = await ctx.android.fetchAll();
    await displayAndroidCredentials(Object.values(credentials));

    const question: Question = {
      type: 'list',
      name: 'experienceName',
      message: 'Select application',
      choices: Object.values(credentials).map(cred => ({
        name: cred.experienceName,
        value: cred.experienceName,
      })),
      pageSize: Infinity,
    };
    const { experienceName } = await prompt(question);

    return new androidView.ExperienceView(experienceName);
  }
}

export class QuitError extends Error {
  constructor() {
    super();

    // Set the prototype explicitly.
    // https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, QuitError.prototype);
  }
}

export interface IQuit {
  runAsync(mainpage: IView): Promise<IView>;
}

export class DoQuit implements IQuit {
  async runAsync(mainpage: IView): Promise<IView> {
    throw new QuitError();
  }
}

export class AskQuit implements IQuit {
  async runAsync(mainpage: IView): Promise<IView> {
    const { selected } = await prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Do you want to quit Credential Manager',
        choices: [
          { value: 'exit', name: 'Quit Credential Manager' },
          { value: 'mainpage', name: 'Go back to experience overview.' },
        ],
      },
    ]);
    if (selected === 'exit') {
      process.exit(0);
    }
    return mainpage;
  }
}
