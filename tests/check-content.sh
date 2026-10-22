#!/bin/sh
# Acceptance 13: content.js must be byte-identical to the verbatim source (first committed version).
set -e
cd "$(dirname "$0")/.."
git show a0a2392:content.js | cmp - content.js && echo "content.js byte-identical to a0a2392"
