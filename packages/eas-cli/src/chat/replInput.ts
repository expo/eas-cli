import readline from 'node:readline';

/**
 * A minimal line-editor for the interactive chat loop, built on Node's built-in `readline`. Reusing
 * a single interface across turns gives arrow-key history for free. It stays in the normal scrolling
 * terminal buffer (no alternate screen), so the transcript remains selectable and scrollable.
 */
export type ChatReplInput = {
  /** Prompts for a line. Resolves the entered text, or `null` when the input closes (Ctrl-D/Ctrl-C). */
  askAsync(prompt: string): Promise<string | null>;
  close(): void;
};

export function createChatReplInput(options?: {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  terminal?: boolean;
}): ChatReplInput {
  const inputStream = options?.input ?? process.stdin;
  const rl = readline.createInterface({
    input: inputStream,
    output: options?.output ?? process.stdout,
    terminal: options?.terminal ?? true,
    historySize: 100,
  });

  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  // Ctrl-C at the prompt ends the session cleanly instead of leaving the terminal in a raw state.
  rl.on('SIGINT', () => {
    rl.close();
  });

  return {
    async askAsync(prompt: string): Promise<string | null> {
      if (closed) {
        return null;
      }
      // A spinner (ora) or a previous reader can leave stdin paused; resuming it recovers input and
      // keeps the event loop alive while we wait, so the prompt does not exit immediately.
      inputStream.resume();
      return await new Promise<string | null>(resolve => {
        let settled = false;
        const onClose = (): void => {
          if (!settled) {
            settled = true;
            resolve(null);
          }
        };
        rl.once('close', onClose);
        rl.question(prompt, answer => {
          if (!settled) {
            settled = true;
            rl.removeListener('close', onClose);
            resolve(answer);
          }
        });
      });
    },
    close(): void {
      if (!closed) {
        rl.close();
      }
    },
  };
}
