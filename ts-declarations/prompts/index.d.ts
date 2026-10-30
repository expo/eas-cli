declare module 'prompts/lib/elements' {
  class MultiselectPrompt {
    selectionFormat: string | undefined;
    done: boolean | undefined;
    value: any[] | undefined;

    constructor(parameters: any);
    on(event: string, callback: (args: any) => any): any;
    renderDoneOrInstructions(): string;
  }

  class SelectPrompt {
    cursor: number;
    choices: { disabled?: boolean }[];
    value: any;

    constructor(parameters: any);
    on(event: string, callback: (args: any) => any): any;
    moveCursor(n: number): void;
    render(): void;
  }
}
