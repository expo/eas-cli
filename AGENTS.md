# AGENTS.md

When working with this repository follow instructions from CLAUDE.md.

- [./CLAUDE.md](./CLAUDE.md)
- Before committing, run the formatter on modified files.

## Customer privacy

Never name or identify an Expo customer anywhere in this repository or on GitHub. This applies to code, comments, tests and fixtures, docs, changesets, commit messages, branch names, and PR titles, descriptions, and comments.

- Do not include customer, company, or app names; Expo account or project names (for example `@account/project` slugs or `expo.dev/accounts/...` URLs); usernames or emails; account, project, build, job, or session IDs from production; bundle identifiers or Android package names; or target and extension names from a customer's app.
- Describe affected customers in general terms, such as "one app", "4 apps", or "a customer reported". Counts, dates, and error messages are fine after you remove identifying values.
- In tests and examples, use invented placeholders, such as `MyApp.app`, `com.example.app`, `@example/my-app`, and `NotificationServiceExtension`.
- Before you paste production logs, error output, or stack traces, remove all identifying values, including file paths that contain app or account names.
- Before you push, or open or update a PR, check the diff, commit messages, and PR description for customer identifiers.
