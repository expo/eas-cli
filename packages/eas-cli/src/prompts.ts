import { constants } from 'os';
import prompts, { Answers, Choice, Options, prompts as PromptElements, PromptType } from 'prompts';

import { Question, easMultiselect } from './easMultiselect';
export { PromptType, Question, Choice };

if (PromptElements) {
  PromptElements.multiselect = easMultiselect;
}

export interface ExpoChoice<T> extends Choice {
  value: T;
}

type NamelessQuestion = Omit<Question<'value'>, 'name' | 'type'>;

export async function promptAsync<T extends string = string>(
  questions: Question<T> | Question<T>[],
  options: Options = {}
): Promise<Answers<T>> {
  if (!process.stdin.isTTY && !global.test) {
    const message = Array.isArray(questions) ? questions[0]?.message : questions.message;
    throw new Error(
      `Input is required, but stdin is not readable. Failed to display prompt: ${message}`
    );
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
  config?: {
    options?: Options;
    initial?: T;
    warningMessageForDisabledEntries?: string;
  }
): Promise<T> {
  const initial = config?.initial ? choices.findIndex(({ value }) => value === config.initial) : 0;
  const { value } = await promptAsync(
    {
      message,
      choices,
      initial,
      name: 'value',
      type: 'select',
      warn: config?.warningMessageForDisabledEntries,
    },
    config?.options ?? {}
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
