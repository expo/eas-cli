import { getVcsClient } from '../../vcs';
import ContextField from './ContextField';

export default class VcsRepoExistsContextField extends ContextField<{
  exists: boolean;
}> {
  async getValueAsync(): Promise<{
    exists: boolean;
  }> {
    let exists = false;

    const client = getVcsClient();

    try {
      await client.ensureRepoExistsAsync();
      exists = true;
    } catch (_error) {
      exists = false;
    }

    return {
      exists,
    };
  }
}
