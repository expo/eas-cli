import readline from 'node:readline';

export type ChatReplInput = {
  askAsync(prompt: string): Promise<string | null>;
  close(): void;
};

export function createChatReplInput(options?: {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  terminal?: boolean;
  history?: string[];
}): ChatReplInput {
  const inputStream = options?.input ?? process.stdin;
  const rl = readline.createInterface({
    input: inputStream,
    output: options?.output ?? process.stdout,
    terminal: options?.terminal ?? true,
    historySize: 100,
    history: options?.history,
  });

  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  rl.on('SIGINT', () => {
    rl.close();
  });

  return {
    async askAsync(prompt: string): Promise<string | null> {
      if (closed) {
        return null;
      }
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
