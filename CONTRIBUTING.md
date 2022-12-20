# Development

Set up an alias for the EAS CLI so you can try it in projects all around your computer. The project is compiled on the fly so you don't need to run a build (watch) command. Open your `.zshrc` or other config file and add:

```
alias easd="/PATH/TO/eas-cli/bin/run"
```

Then use it with `easd` like `easd build`.

Optional: to start the build command in watch mode run:

```
yarn start
```

## Format

- Be sure to update the [`CHANGELOG.md`](./CHANGELOG.md) with changes for every PR. There is a changelog bot that can generate the proper entry for you. The instructions on how to use it are in the PR description placeholder.
- End `async` functions with `Async` like `runAsync`. This is just how we format functions at Expo.
- Utilize the unified `Log` module instead of `console.log`.

## Using local and staging API

For development against local API:

- Set up the API server as described at https://github.com/expo/universe/tree/main/server/www.
- Set the `EXPO_LOCAL=1` env variable either on every command run (e.g. `EXPO_LOCAL=1 easd ...`) or more permamently with `export EXPO_LOCAL=1` (works in a current shell session).

For development against staging API:

- Set the `EXPO_STAGING=1` env variable either on every command run (e.g. `EXPO_STAGING=1 easd ...`) or more permamently with `export EXPO_STAGING=1` (works in a current shell session).

## Testing

Run `yarn test` either in the repository root or in a package directory that you're working on.

# Releasing a new version

1. Run `yarn release` in the repository root folder. The next version is chosen automatically based on the changelog entries. If you want to use different version, pass the version string as a positional argument to the command, e.g. `yarn release 1.2.3`.
2. That's it! GitHub Actions is going to take care of the rest. Watch the #eas-cli Slack channel for a successful release notification.
