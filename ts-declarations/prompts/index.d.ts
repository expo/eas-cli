declare module 'prompts/lib/elements' {
  class MultiselectPrompt {
    cursor: number;
    selectionFormat: string | undefined;
    done: boolean | undefined;
    hint: string;
    maxChoices: number | undefined;
    value: any[];
    warn: string;

    constructor(parameters: any);
    _(c: string, key: unknown): void;
    bell(): void;
    down(): void;
    exit(): void;
    first(): void;
    handleSpaceToggle(): void;
    last(): void;
    left(): void;
    next(): void;
    on(event: string, callback: (args: any) => any): any;
    render(): void;
    renderDoneOrInstructions(): string;
    renderOptions(options: any[]): string;
    right(): void;
    submit(): void;
    toggleAll(): void;
    up(): void;
  }
}
