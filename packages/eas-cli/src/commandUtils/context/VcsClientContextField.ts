import ContextField from './ContextField';
import { getVcsClient } from '../../vcs';
import { Client } from '../../vcs/vcs';

export default class VcsClientContextField extends ContextField<Client> {
  async getValueAsync(): Promise<Client> {
    return getVcsClient();
  }
}
