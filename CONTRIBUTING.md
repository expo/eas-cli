# Development

Set up an alias for the EAS CLI so you can try it in projects all around your computer. The project is compiled on the fly so you don't need to run a build (watch) command.

> The only exception is when you just cloned the repository or there have been changes in `packages/eas-json`. In that case, you'll have to run `yarn build` in the root.

Open your `.zshrc` or other config file and add:

```
alias easd="/PATH/TO/eas-cli/bin/run"
```

Then use it with `easd` like `easd build`.

If you're making changes to `packages/eas-json` or prefer/need to work with production code, start the build command in watch mode with:

```
yarn start
```

If it is easier for you to work with the code locally with compiler options set to:

```json
...
"compilerOptions": {
    ...
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    ...
}
...
```

you can consider using:

```
yarn start-allow-unused
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

## Working on local builds (`eas build --local`)

See https://github.com/expo/eas-build/blob/main/DEVELOPMENT.md for how to set up your environment when making changes to [`eas-cli-local-build-plugin`](https://github.com/expo/eas-build/tree/main/packages/local-build-plugin) and/or [`build-tools`](https://github.com/expo/eas-build/tree/main/packages/build-tools).

## Testing

Run `yarn test` either in the repository root or in a package directory that you're working on.

## Releasing

See [RELEASING.md](./RELEASING.md).
