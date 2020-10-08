import { constants } from 'os';
import prompts, { Answers, Choice, Options, PromptType, PromptObject as Question } from 'prompts';

export { PromptType, Question, Choice };

type NamelessQuestion = Omit<Question<'value'>, 'name' | 'type'>;

export async function promptAsync<T extends string = string>(
  questions: Question<T> | Question<T>[],
  options: Options = {}
): Promise<Answers<T>> {
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
