import SessionManager from '../../user/SessionManager';
import ContextField, { ContextOptions } from './ContextField';

export default class SessionManagementContextField extends ContextField<SessionManager> {
  async getValueAsync({ sessionManager }: ContextOptions): Promise<SessionManager> {
    return sessionManager;
  }
}
