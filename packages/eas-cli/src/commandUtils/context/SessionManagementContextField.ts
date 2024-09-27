import ContextField, { ContextOptions } from './ContextField';
import SessionManager from '../../user/SessionManager';

export default class SessionManagementContextField extends ContextField<SessionManager> {
  async getValueAsync({ sessionManager }: ContextOptions): Promise<SessionManager> {
    return sessionManager;
  }
}
