import { Choice, PromptObject } from 'prompts';
import { SelectPrompt } from 'prompts/lib/elements';

export type SelectChoice = Choice & {
  /**
   * Shown next to the prompt message while this choice is highlighted and disabled, in place of the
   * prompt's `warn`. prompts never shows the description of a disabled choice.
   */
  disabledReason?: string;
};

type SelectQuestion = Omit<PromptObject, 'choices'> & { choices: SelectChoice[] };

/**
 * Customized select prompt.
 *
 * Additional parameters:
 *
 * @param choices[].disabledReason
 *   Why the choice is disabled. Use it when the reason differs per choice, because `warn` is the
 *   same for every choice.
 **/
export default class EasSelect extends SelectPrompt {
  private readonly disabledReasons: (string | undefined)[];
  // `declare` so the field is not initialized after super(), which would reset the value that the
  // `warn` setter stores during the SelectPrompt constructor.
  declare private defaultWarn: string | undefined;

  constructor(opts: SelectQuestion) {
    super(opts);
    this.disabledReasons = opts.choices.map(choice => choice.disabledReason);

    // Start on an enabled choice when the initial one is disabled.
    if (this.choices[this.cursor]?.disabled) {
      const firstEnabledIndex = this.choices.findIndex(choice => !choice.disabled);
      if (firstEnabledIndex !== -1) {
        this.moveCursor(firstEnabledIndex);
      }
    }

    // SelectPrompt renders at the end of its constructor, before `disabledReasons` is set, so render
    // again to show the reason of the highlighted choice.
    this.render();
  }

  // SelectPrompt assigns `warn` in its constructor and reads it in render() when the highlighted
  // choice is disabled.
  get warn(): string | undefined {
    const reason = this.disabledReasons?.[this.cursor];
    return this.choices[this.cursor]?.disabled && reason ? `- ${reason}` : this.defaultWarn;
  }

  set warn(value: string | undefined) {
    this.defaultWarn = value;
  }
}

// prompts enables j/k navigation only when `constructor.name` is SelectPrompt or MultiselectPrompt.
Object.defineProperty(EasSelect, 'name', { value: 'SelectPrompt' });

export const easSelect = (args: PromptObject): Promise<any> => {
  return new Promise((res, rej) => {
    const p = new EasSelect(args as SelectQuestion);
    p.on('submit', x => {
      res(x);
    });
    p.on('exit', x => {
      res(x);
    });
    p.on('abort', x => {
      rej(x);
    });
  });
};
