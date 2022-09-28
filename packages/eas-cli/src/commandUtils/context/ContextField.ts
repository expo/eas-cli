export interface ContextOptions {
  nonInteractive: boolean;
}

export default abstract class ContextField<T> {
  abstract getValueAsync(options: ContextOptions): Promise<T>;
}
