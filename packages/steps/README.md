# @expo/steps

TBD

### Examples

If you want to run config examples from the **examples** directory, e.g. **examples/simple**, follow the steps:

- Run `yarn` and `yarn build` in the root of the monorepo.
- Add `alias eas-steps="/REPLACE/WITH/PATH/TO/eas-build/packages/steps/cli.sh"` to your **.zshrc**/**.bashrc**/etc.
- cd into **examples/simple** and run `eas-steps config.yml project [darwin|linux]`. The first argument is the config file, and the second is the default working directory for the config file. The third argument is the platform for which you want to simulate running a custom build, it defaults to the platform of the device on which the CLI is currently being run.

### Example project

See the example project using custom builds at https://github.com/expo/eas-custom-builds-example.
