import { exit } from '@oclif/errors';
import { constants } from 'os';
import prompts, { Options, PromptType, PromptObject as Question } from 'prompts';

export { PromptType, Question };

type PromptOptions = { nonInteractiveHelp?: string } & Options;

export function prompt(questions: Question | Question[], options: PromptOptions = {}) {
  return prompts(questions, {
    onCancel() {
      exit(constants.signals.SIGINT + 128); // Exit code 130 used when process is interrupted with ctrl+c.
    },
    ...options,
  });
}
