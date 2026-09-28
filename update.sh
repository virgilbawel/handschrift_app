#!/bin/sh
# Zet al je wijzigingen op GitHub (en daarmee automatisch live op Render).
# Gebruik:  npm run update                      -> standaardbericht
#           npm run update -- "Hero-tekst aangepast"   -> eigen bericht
set -e
cd "$(dirname "$0")"

if [ -z "$(git status --porcelain)" ]; then
  echo "Er is niets gewijzigd — niets om te uploaden."
  exit 0
fi

echo "Deze bestanden worden bijgewerkt:"
git status --short
git add -A
git commit -q -m "${1:-Teksten aangepast}"
git push -q
echo "✅ Klaar! De wijzigingen staan op GitHub."
