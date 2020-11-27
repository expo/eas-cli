#!/usr/bin/env sh

OUTFILE="src/graphql/generated.ts"

content="/**
 * This file was generated using GraphQL Codegen
 * Command: yarn generate-graphql-code
 * Run this during development for automatic type generation when editing GraphQL documents
 * For more info and docs, visit https://graphql-code-generator.com/
 */
"

printf '%s\n%s\n' "$content" "$(cat $OUTFILE)" > $OUTFILE
