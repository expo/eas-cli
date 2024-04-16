import EnvironmentVariableCreate from './create';

// TOOD: Currently it is the same as create
export default class EnvironmentVariableUpdate extends EnvironmentVariableCreate {
  static override description =
    'update an environment variable on the current project or owner account';
}
