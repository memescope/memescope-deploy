#!/bin/bash
# Restore symlinks after deploy so local dev works normally

JS_FILES="app.js boost.js embed.js ens.js extras.js wallet.js"
CSS_FILES="styles.css"
HTML_FILES="index.html"

for f in $JS_FILES $CSS_FILES $HTML_FILES; do
  if [ -f "public/$f" ] && [ ! -L "public/$f" ]; then
    rm "public/$f"
    ln -s "../$f" "public/$f"
    echo "  🔗 public/$f → ../$f"
  fi
done

echo "✨ Symlinks restored for local dev."
