// @ts-ignore
import { MultiSelect } from 'enquirer';
import { constants } from 'os';
import prompts, { Answers, Choice, Options, PromptType, PromptObject as Question } from 'prompts';

import { PAGINATION_FETCH_MORE_VALUE } from './utils/queryConstants';

export { PromptType, Question, Choice };

export interface ExpoChoice<T> extends Choice {
  value: T;
}

type NamelessQuestion = Omit<Question<'value'>, 'name' | 'type'>;

export async function promptAsync<T extends string = string>(
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

export async function confirmAsync(
  question: NamelessQuestion,
  options?: Options
): Promise<boolean> {
  const { value } = await promptAsync(
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
export async function selectAsync<T>(
  message: string,
  choices: ExpoChoice<T>[],
  options?: Options
): Promise<T> {
  const { value } = await promptAsync(
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
export async function toggleConfirmAsync(
  questions: NamelessQuestion,
  options?: Options
): Promise<boolean> {
  const { value } = await promptAsync(
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

export async function pressAnyKeyToContinueAsync(): Promise<void> {
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

class ExpoMultiSelect extends MultiSelect {
  state: any;
  selected: any;
  styles: any;
  run!: () => Promise<any>;
  submit!: () => Promise<any>;

  constructor(options = {}) {
    super({ ...options, multiple: true });
  }

  toggle(choice: ExpoChoice<any>, enabled: boolean): ExpoChoice<any> | void {
    super.toggle(choice, enabled);

    if (choice?.value === PAGINATION_FETCH_MORE_VALUE) {
      this.submit();
      return;
    }

    return choice;
  }

  format(): string {
    if (!this.state.submitted || this.state.cancelled) {
      return '';
    }

    if (Array.isArray(this.selected)) {
      return this.selected
        .filter(choice => choice.value !== PAGINATION_FETCH_MORE_VALUE)
        .map(choice => this.styles.primary(choice.name))
        .join(', ');
    }

    return this.styles.primary(this.selected.name);
  }
}

export async function multiselectAsync<T>(message: string, choices: ExpoChoice<T>[]): Promise<T[]> {
  const result = await new ExpoMultiSelect({
    message,
    // prompt will mutate input
    choices,
    initial: choices.filter(x => x.selected),
  }).run();

  if (result && typeof choices === 'object' && choices.length > 0) {
    return choices.filter(choice => result.includes(choice.title)).map(choice => choice.value);
  }

  return result ?? null;
}
