import { constants } from 'os';
import prompts, { Answers, Choice, Options, PromptType, PromptObject as Question } from 'prompts';

export { PromptType, Question, Choice };

export interface ExpoChoice<T> extends Choice {
  value: T;
}

type NamelessQuestion = Omit<Question<'value'>, 'name' | 'type'>;

export interface Prompts {
  promptAsync<T extends string = string>(
    questions: Question<T> | Question<T>[],
    options?: Options
  ): Promise<Answers<T>>;
  confirmAsync(question: NamelessQuestion, options?: Options): Promise<boolean>;
  selectAsync<T>(message: string, choices: ExpoChoice<T>[], options?: Options): Promise<T>;
  toggleConfirmAsync(questions: NamelessQuestion, options?: Options): Promise<boolean>;
  pressAnyKeyToContinueAsync(): Promise<void>;
}

export class NonInteractivePrompts implements Prompts {
  private static errorMessage =
    'Command can not be run as specified in non-interactive mode. Run the command with --help to see arguments and flags required to run in non-interactive mode.';

  async promptAsync<T extends string = string>(
    _questions: prompts.PromptObject<T> | prompts.PromptObject<T>[],
    _options: prompts.Options
  ): Promise<prompts.Answers<T>> {
    throw new Error(NonInteractivePrompts.errorMessage);
  }

  async confirmAsync(
    _question: NamelessQuestion,
    _options?: prompts.Options | undefined
  ): Promise<boolean> {
    throw new Error(NonInteractivePrompts.errorMessage);
  }

  async selectAsync<T>(
    _message: string,
    _choices: ExpoChoice<T>[],
    _options?: prompts.Options | undefined
  ): Promise<T> {
    throw new Error(NonInteractivePrompts.errorMessage);
  }

  async toggleConfirmAsync(
    _questions: NamelessQuestion,
    _options?: prompts.Options | undefined
  ): Promise<boolean> {
    throw new Error(NonInteractivePrompts.errorMessage);
  }

  async pressAnyKeyToContinueAsync(): Promise<void> {
    throw new Error(NonInteractivePrompts.errorMessage);
  }
}

export class InteractivePrompts implements Prompts {
  async promptAsync<T extends string = string>(
    questions: Question<T> | Question<T>[],
    options: Options = {}
  ): Promise<Answers<T>> {
    if (!process.stdin.isTTY && !global.test) {
      throw new Error('Input is required, but stdin is not readable.');
    }
    return await prompts<T>(questions, {
      onCancel() {
        process.exit(constants.signals.SIGINT + 128); // Exit code 130 used when process is interrupted with ctrl+c.
      },
      ...options,
    });
  }

  async confirmAsync(question: NamelessQuestion, options?: Options): Promise<boolean> {
    const { value } = await this.promptAsync(
      {
        initial: true,
        ...question,
        name: 'value',
        type: 'confirm',
      },
      options
    );
    return value;
  }
  async selectAsync<T>(message: string, choices: ExpoChoice<T>[], options?: Options): Promise<T> {
    const { value } = await this.promptAsync(
      {
        message,
        choices,
        name: 'value',
        type: 'select',
      },
      options
    );
    return value ?? null;
  }

  /**
   * Create a more dynamic yes/no confirmation that can be cancelled.
   *
   * @param questions
   * @param options
   */
  async toggleConfirmAsync(questions: NamelessQuestion, options?: Options): Promise<boolean> {
    const { value } = await this.promptAsync(
      {
        active: 'yes',
        inactive: 'no',
        ...questions,
        name: 'value',
        type: 'toggle',
      },
      options
    );
    return value ?? null;
  }

  async pressAnyKeyToContinueAsync(): Promise<void> {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    await new Promise<void>(res => {
      process.stdin.on('data', key => {
        if (String(key) === '\u0003') {
          process.exit(constants.signals.SIGINT + 128); // ctrl-c
        }
        res();
      });
    });
  }
}
