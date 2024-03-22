import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

import ContextField from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { resolveVcsClient } from '../../vcs';
import { Client } from '../../vcs/vcs';

export default class VcsClientContextField extends ContextField<Client> {
  async getValueAsync({ vcsClientOverride }: { vcsClientOverride?: Client }): Promise<Client> {
    if (vcsClientOverride) {
      return vcsClientOverride;
    }
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
    const config = await EasJsonUtils.getCliConfigAsync(easJsonAccessor);
    return resolveVcsClient(config?.requireCommit);
  }
}
