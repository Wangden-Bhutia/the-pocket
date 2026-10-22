#!/bin/sh
# Acceptance 13: content.js must match the user-approved text (verbatim Attachment A + the 4 approved text changes, PR #1).
# Any future text change needs explicit approval and a new hash here.
set -e
cd "$(dirname "$0")/.."
echo "7078aa0f1bff11e16cbfaa4114a23e61b00981cb7f5e60ece2999ec4a5525490  content.js" | sha256sum -c -
