import SessionManager from '../../user/SessionManager';

export interface ContextOptions {
  sessionManager: SessionManager;
  nonInteractive: boolean;
}

export default abstract class ContextField<T> {
  abstract getValueAsync(options: ContextOptions): Promise<T>;
}
