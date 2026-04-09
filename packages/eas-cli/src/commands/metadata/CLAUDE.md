# CLAUDE.md - metadata commands

`metadata:push` validates `store.config.json` against `packages/eas-cli/schema/metadata-0.json`. The schema can drift from the apple config reader/writer, and when it does `metadata:pull` happily writes fields that `metadata:push` then rejects — and the failure looks like the user's fault.

**Whenever you touch `src/metadata/apple/config/{reader,writer}.ts`, update `metadata-0.json` in the same change.** For new advisory fields:

- Add the property under `definitions.apple.AppleAdvisory.properties`.
- For enums from `@expo/apple-utils`, add a matching `Apple<Name>` enum definition with the exact string values and reference it via `$ref`. Wrap in `oneOf` with `{ "type": "null" }` if the writer ever persists `null`.
- Don't add to `required` — that breaks existing user configs. Optional with a sensible default in the writer is the convention.

The drift is caught by `src/metadata/apple/config/__tests__/writer.test.ts` ("writer output for ... passes JSON schema validation"). If you change apple-utils types or fixtures, that test will tell you exactly what the schema is missing.
