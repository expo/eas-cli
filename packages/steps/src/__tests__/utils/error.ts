export class NoErrorThrownError extends Error {}

export const getErrorAsync = async <TError = any>(
  call: () => unknown
): Promise<TError | NoErrorThrownError> => {
  try {
    await call();
    throw new NoErrorThrownError();
  } catch (error: unknown) {
    return error as TError;
  }
};

export const getError = <TError = any>(call: () => unknown): TError | NoErrorThrownError => {
  try {
    call();
    throw new NoErrorThrownError();
  } catch (error: unknown) {
    return error as TError;
  }
};
