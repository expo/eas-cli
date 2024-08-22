import { Choice, PromptObject } from 'prompts';
import { MultiselectPrompt } from 'prompts/lib/elements';

const noop = (): void => {};

export type Question<T extends string = string> = PromptObject<T> & {
  selectionFormat?: string;
};

/**
 * Customized multiselect prompt.
 *
 * Additional parameters:
 *
 * @param selectionFormat
 *   String indicating number of selected options. Should contain `<num>` substring.
 *
 *   Example:
 *     'Selected <num> devices'
 *
 *   Short format is used when more than one option is selected.
 *
 **/

export default class EasMultiselect extends MultiselectPrompt {
  constructor(opts: Question) {
    super(opts);
    this.selectionFormat = opts.selectionFormat;
  }
  override renderDoneOrInstructions(): string {
    if (this.done && this.selectionFormat && this.value) {
      const selectedOptionsCount = this.value.filter(e => e.selected).length;

      if (selectedOptionsCount > 1) {
        return this.selectionFormat.replace('<num>', selectedOptionsCount.toString());
      }
    }
    return super.renderDoneOrInstructions();
  }
}

export const easMultiselect = (args: Question): Promise<Choice[]> => {
  const toSelected = (items: Choice[]): Choice[] =>
    items.filter(item => item.selected).map(item => item.value);

  return new Promise((res, rej) => {
    const p = new EasMultiselect(args);
    const onAbort = toSelected || noop;
    const onSubmit = toSelected || noop;
    p.on('submit', x => {
      res(onSubmit(x));
    });
    p.on('abort', x => {
      rej(onAbort(x));
    });
  });
};
