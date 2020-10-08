import { constants } from 'os';
import prompts, { Answers, Options, PromptType, PromptObject as Question } from 'prompts';

export { PromptType, Question };

type NamelessQuestion = Omit<Question<'value'>, 'name' | 'type'>;

export async function promptAsync<T extends string = string>(
  questions: Question<T> | Question<T>[],
  options: Options = {}
): Promise<prompts.Answers<T>> {
  return await prompts(questions, {
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
  return value ?? null;
}
