#!/bin/bash
# Build script: minify source files into /public/ for deployment
# Replaces symlinks with minified versions

echo "🔨 Building minified assets..."

# Files to minify (symlinked from root to public/)
JS_FILES="app.js boost.js embed.js ens.js extras.js wallet.js"
CSS_FILES="styles.css"

# Remove symlinks and minify JS files
for f in $JS_FILES; do
  if [ -f "$f" ]; then
    rm -f "public/$f"
    npx esbuild "$f" --minify --outfile="public/$f" 2>/dev/null
    echo "  ✅ $f minified"
  fi
done

# Minify CSS
for f in $CSS_FILES; do
  if [ -f "$f" ]; then
    rm -f "public/$f"
    npx esbuild "$f" --minify --outfile="public/$f" 2>/dev/null
    echo "  ✅ $f minified"
  fi
done

# Copy HTML
rm -f "public/index.html"
cp index.html "public/index.html"
echo "  ✅ index.html copied"

# Show size comparison
echo ""
echo "📊 Size comparison:"
for f in $JS_FILES $CSS_FILES; do
  if [ -f "$f" ] && [ -f "public/$f" ]; then
    orig=$(wc -c < "$f" | tr -d ' ')
    mini=$(wc -c < "public/$f" | tr -d ' ')
    saved=$((orig - mini))
    pct=$((saved * 100 / orig))
    echo "  $f: ${orig}B → ${mini}B (-${pct}%)"
  fi
done

echo ""
echo "✨ Build complete!"
