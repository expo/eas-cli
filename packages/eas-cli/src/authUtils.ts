import SessionManager from './user/SessionManager';

// Handle the case where a user needs to be in sudo mode to perform an action.
export async function handleSudoCallAsync<T>(
  sessionManager: SessionManager,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isSudoError = error.graphQLErrors?.some(
      (err: { extensions: { errorCode: string } }) =>
        err?.extensions?.errorCode === 'SUDO_MODE_REQUIRED'
    );
    if (!isSudoError) {
      throw error;
    }
    await sessionManager.showSudoPromptAsync({ sso: false });
    return await fn();
  }
}
