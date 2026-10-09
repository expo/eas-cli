# AGENTS.md

When working with this repository follow instructions from CLAUDE.md.

- [./CLAUDE.md](./CLAUDE.md)
- Before committing, run the formatter on modified files.
- Use null-prototype records for object-shaped dictionaries keyed by user-controlled identifiers.
  Keep these dictionaries as records throughout runtime code; only convert them at explicit
  serialization boundaries. Use `Map` for internal collections that do not need an object-shaped
  API or JSON representation.
