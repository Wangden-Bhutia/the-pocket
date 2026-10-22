#!/bin/sh
# Acceptance 13: content.js must match the user-approved text (verbatim Attachment A + the 4 approved text changes, PR #1).
# Any future text change needs explicit approval and a new hash here.
set -e
cd "$(dirname "$0")/.."
echo "09743f590a7a9c37259312c78f83d6577ff304e4582c8678d3c5a0c8a7973324  content.js" | sha256sum -c -
