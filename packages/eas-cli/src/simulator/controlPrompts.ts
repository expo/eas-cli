import { Question, promptAsync } from '../prompts';

export class ControlPromptCancelledError extends Error {
  constructor() {
    super('Simulator control interrupted.');
    this.name = 'ControlPromptCancelledError';
  }
}

type ActivePrompt = { abort(): void; closed?: boolean; done?: boolean };

/** Unlike the default prompt cancellation, this unwinds through the connection's cleanup. */
export async function promptControlValueAsync(
  question: Omit<Question<'value'>, 'name'>,
  signal: AbortSignal
): Promise<unknown> {
  signal.throwIfAborted();
  let active: ActivePrompt | undefined;
  let abortQueued = false;
  const abort = (): void => {
    if (abortQueued) {
      return;
    }
    abortQueued = true;
    // The first render happens inside the prompt constructor, before its abort listener exists.
    queueMicrotask(() => {
      abortQueued = false;
      if (active && !active.closed && !active.done) {
        active.abort();
      }
    });
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const result = await promptAsync(
      {
        ...question,
        name: 'value',
        onRender(this: ActivePrompt, kleur) {
          active = this;
          question.onRender?.call(this, kleur);
          if (signal.aborted) {
            abort();
          }
        },
      },
      {
        onCancel() {
          signal.throwIfAborted();
          throw new ControlPromptCancelledError();
        },
      }
    );
    signal.throwIfAborted();
    return result.value;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
