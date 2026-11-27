import { Choice, PromptObject } from 'prompts';
import { MultiselectPrompt } from 'prompts/lib/elements';

const noop = (): void => {};

export type Question<T extends string = string> = PromptObject<T> & {
  selectionFormat?: string;
  searchable?: boolean;
};

type EasMultiselectChoice = Choice & {
  description?: string;
  disabled?: boolean;
  selected?: boolean;
  title?: string;
  value?: unknown;
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
 * @param searchable
 *   Enables slash-prefixed text filtering. Press `/` to enter search, Enter to apply the
 *   current search, and Escape to clear it.
 *
 **/

export default class EasMultiselect extends MultiselectPrompt {
  private searchQuery = '';
  private searchInputActive = false;
  private readonly searchable: boolean;

  constructor(opts: Question) {
    super({ ...opts, overrideRender: true });
    this.selectionFormat = opts.selectionFormat;
    this.searchable = opts.searchable ?? false;
    this.render();
  }

  override renderDoneOrInstructions(): string {
    if (this.done && this.selectionFormat && this.value) {
      const selectedOptionsCount = this.value.filter(e => e.selected).length;

      if (selectedOptionsCount > 1) {
        return this.selectionFormat.replace('<num>', selectedOptionsCount.toString());
      }
    }
    if (this.searchable && !this.done) {
      return this.renderSearchablePromptStatus();
    }
    return super.renderDoneOrInstructions();
  }

  override renderOptions(_options: EasMultiselectChoice[]): string {
    const visibleOptions = this.visibleOptions;
    return super.renderOptions(visibleOptions);
  }

  override first(): void {
    this.cursor = 0;
    this.render();
  }

  override last(): void {
    this.cursor = Math.max(this.visibleOptions.length - 1, 0);
    this.render();
  }

  override next(): void {
    const visibleOptionsCount = this.visibleOptions.length;
    if (visibleOptionsCount === 0) {
      return this.bell();
    }
    this.cursor = (this.cursor + 1) % visibleOptionsCount;
    this.render();
  }

  override up(): void {
    const visibleOptionsCount = this.visibleOptions.length;
    if (visibleOptionsCount === 0) {
      return this.bell();
    }
    this.cursor = this.cursor === 0 ? visibleOptionsCount - 1 : this.cursor - 1;
    this.render();
  }

  override down(): void {
    const visibleOptionsCount = this.visibleOptions.length;
    if (visibleOptionsCount === 0) {
      return this.bell();
    }
    this.cursor = this.cursor === visibleOptionsCount - 1 ? 0 : this.cursor + 1;
    this.render();
  }

  override left(): void {
    const choice = this.highlightedChoice;
    if (!choice) {
      return this.bell();
    }
    choice.selected = false;
    this.render();
  }

  override right(): void {
    const choice = this.highlightedChoice;
    if (!choice || choice.disabled) {
      return this.bell();
    }
    if (this.isAtMaxChoices) {
      return this.bell();
    }
    choice.selected = true;
    this.render();
  }

  override handleSpaceToggle(): void {
    const choice = this.highlightedChoice;
    if (!choice) {
      return this.bell();
    }
    if (choice.selected) {
      choice.selected = false;
      this.render();
    } else if (choice.disabled || this.isAtMaxChoices) {
      return this.bell();
    } else {
      choice.selected = true;
      this.render();
    }
  }

  override toggleAll(): void {
    if (this.maxChoices !== undefined) {
      return this.bell();
    }
    const choice = this.highlightedChoice;
    if (!choice || choice.disabled) {
      return this.bell();
    }
    const newSelected = !choice.selected;
    this.visibleOptions
      .filter(option => !option.disabled)
      .forEach(option => (option.selected = newSelected));
    this.render();
  }

  override submit(): void {
    if (this.searchable && this.searchInputActive) {
      this.searchInputActive = false;
      this.render();
      return;
    }
    super.submit();
  }

  override exit(): void {
    if (this.searchable && (this.searchInputActive || this.searchQuery)) {
      this.clearSearch();
      return;
    }
    super.exit();
  }

  delete(): void {
    if (!this.searchable || (!this.searchInputActive && !this.searchQuery)) {
      return this.bell();
    }
    if (this.searchInputActive && !this.searchQuery) {
      this.searchInputActive = false;
      this.render();
      return;
    }
    this.searchInputActive = true;
    this.setSearchQuery(this.searchQuery.slice(0, -1));
  }

  override _(c: string, key: unknown): void {
    if (!this.searchable) {
      super._(c, key);
      return;
    }
    if (this.searchInputActive) {
      this.setSearchQuery(`${this.searchQuery}${c}`);
      return;
    }
    if (c === '/') {
      this.searchQuery = '';
      this.searchInputActive = true;
      this.cursor = 0;
      this.render();
      return;
    }
    super._(c, key);
  }

  private get visibleOptions(): EasMultiselectChoice[] {
    const query = normalizeSearchText(this.searchQuery);
    if (!this.searchable || !query) {
      return this.value;
    }
    return this.value.filter(choice => isSearchMatch(searchableChoiceText(choice), query));
  }

  private get highlightedChoice(): EasMultiselectChoice | undefined {
    return this.visibleOptions[this.cursor];
  }

  private get isAtMaxChoices(): boolean {
    return (
      this.maxChoices !== undefined && this.value.filter(e => e.selected).length >= this.maxChoices
    );
  }

  private setSearchQuery(query: string): void {
    this.searchQuery = query;
    const visibleOptionsCount = this.visibleOptions.length;
    this.cursor = visibleOptionsCount === 0 ? 0 : Math.min(this.cursor, visibleOptionsCount - 1);
    this.render();
  }

  private clearSearch(): void {
    this.searchQuery = '';
    this.searchInputActive = false;
    this.cursor = 0;
    this.render();
  }

  private renderSearchablePromptStatus(): string {
    const parts = [this.hint];
    if (this.searchInputActive || this.searchQuery) {
      const filterStatus = `Filter: /${this.searchQuery}`;
      const matchStatus = `${this.visibleOptions.length}/${this.value.length} matches`;
      parts.push(this.searchInputActive ? filterStatus : `${filterStatus} (${matchStatus})`);
    }
    const choice = this.highlightedChoice;
    if (choice?.disabled) {
      parts.push(this.warn);
    }
    return parts.filter(Boolean).join(' ');
  }
}

function searchableChoiceText(choice: EasMultiselectChoice): string {
  return [choice.title, choice.description, valueToSearchableText(choice.value)]
    .filter(Boolean)
    .join(' ');
}

function valueToSearchableText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function compactSearchText(value: string): string {
  return value.replace(/[^a-z0-9]/g, '');
}

function isSearchMatch(value: string, query: string): boolean {
  const normalizedValue = normalizeSearchText(value);
  return (
    normalizedValue.includes(query) ||
    compactSearchText(normalizedValue).includes(compactSearchText(query))
  );
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
