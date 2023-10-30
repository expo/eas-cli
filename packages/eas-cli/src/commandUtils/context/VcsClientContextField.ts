import { getVcsClient } from '../../vcs';
import { Client } from '../../vcs/vcs';
import ContextField from './ContextField';

export default class VcsClientContextField extends ContextField<Client> {
  async getValueAsync(): Promise<Client> {
    return getVcsClient();
  }
}
