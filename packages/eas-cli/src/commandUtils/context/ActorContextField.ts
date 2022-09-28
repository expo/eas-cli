import { Actor } from '../../user/User';
import ContextField, { ContextOptions } from './ContextField';
import { ensureLoggedInAsync } from './contextUtils/ensureLoggedInAsync';

export default class ActorContextField extends ContextField<Actor> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<Actor> {
    return await ensureLoggedInAsync({ nonInteractive });
  }
}
