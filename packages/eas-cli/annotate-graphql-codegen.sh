#!/usr/bin/env sh

OUTFILE="src/graphql/generated.tsx"

content="/**
 * This file was generated using GraphQL Codegen
 * Command: yarn generate-graphql-code
 * Run this during development for automatic code generation (schema & Apollo types + Apollo hooks & HOCs) when editing GraphQL documents
 * For more info and docs, visit https://graphql-code-generator.com/
 */
"

printf '%s\n%s\n' "$content" "$(cat $OUTFILE)" > $OUTFILE
