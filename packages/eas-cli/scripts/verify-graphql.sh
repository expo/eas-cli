#!/usr/bin/env bash

function cleanup()
{
  echo 'Cleaning up...'
  rm -f graphql.schema.json.bak src/graphql/generated.ts.bak
}

# Fail if anything errors
set -eox pipefail
# If this script exits, trap it first and clean up
trap cleanup EXIT

cp graphql.schema.json graphql.schema.json.bak
cp src/graphql/generated.ts src/graphql/generated.ts.bak

yarn generate-graphql-code
if cmp -s graphql.schema.json graphql.schema.json.bak; then
    echo "GraphQL schema is the same"
    if cmp -s src/graphql/generated.ts src/graphql/generated.ts.bak; then
        echo "GraphQL generated code is the same"
        exit 0
    else
        echo "GraphQL generated code has changed, please commit the changes"
        exit 1
    fi
else
    echo "GraphQL schema has changed, please commit the changes"
    exit 1
fi
