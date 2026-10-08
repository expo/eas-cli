# Changesets

Every PR that changes a package adds a changeset: a Markdown file in this directory that names the changed packages, the bump type, and a one-line summary for the changelog. Do not edit `CHANGELOG.md` files. The release generates them from the changesets.

## Add a changeset

```sh
yarn changeset
```

Select the changed packages and the bump type, then write the summary. Commit the new file with your PR. A changeset looks like this:

```md
---
'eas-cli': minor
'@expo/build-tools': patch
---

Add the `--foo` flag to `eas build`.
```

Write the summary as one sentence in the style of the existing `CHANGELOG.md` entries. The release adds the PR link and the author, and prefixes the entry with the package directories, for example `[eas-cli][build-tools]`.

## Bump types and changelog sections

All packages share one version. The highest bump in all changesets sets the next version. Each entry goes into the root `CHANGELOG.md` section for its highest bump:

| Bump    | Root `CHANGELOG.md` section | Next version |
| ------- | --------------------------- | ------------ |
| `major` | 🛠 Breaking changes         | MAJOR        |
| `minor` | 🎉 New features             | MINOR        |
| `patch` | 🐛 Bug fixes                | PATCH        |
| `none`  | 🧹 Chores                   | no bump      |

`yarn changeset` does not offer `none`. To record a chore, write `none` as the bump type by hand, or run `yarn changeset --empty` for a change that touches no package.

If a PR needs no changelog entry at all, add the "no changelog" label to the PR instead.

See [RELEASING.md](../RELEASING.md) for how a release uses the changesets.
