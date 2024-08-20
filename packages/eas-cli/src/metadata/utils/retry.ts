export async function waitAsync(duration: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, duration));
}

type WithRetryOptions = {
  tries?: number;
  delay?: number;
  onRetry?: (triesLeft: number) => void;
};

export async function retryIfNullAsync<T>(
  method: () => Promise<T | null>,
  options: WithRetryOptions = {}
): Promise<T | null> {
  let { tries = 5, delay = 1000 } = options;

  while (tries > 0) {
    const value = await method();
    if (value !== null) {
      return value;
    }
    tries--;
    options.onRetry?.(tries);
    await waitAsync(delay);
  }

  return null;
}
