import { Context } from './context';

export interface CredentialsManager {
  runActionAsync(action: Action): Promise<void>;

  pushNextAction(action: Action): void;

  popAction(): Action | null;
}

export interface Action {
  runAsync(manager: CredentialsManager, ctx: Context): Promise<void>;
}

export class QuitError extends Error {
  constructor() {
    super();

    // Set the prototype explicitly.
    // https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, QuitError.prototype);
  }
}
