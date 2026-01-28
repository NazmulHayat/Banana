#!/bin/bash
# Deployment script for Supabase Edge Functions
# Copies files from backend/functions to supabase/functions for deployment

set -e

cd "$(dirname "$0")/.." # Navigate to project root

echo "🔧 Preparing Edge Functions for deployment..."

# Clean and recreate supabase/functions directory
echo "📦 Cleaning supabase/functions..."
rm -rf supabase/functions
mkdir -p supabase/functions

# Copy _shared folder
if [ ! -d "backend/functions/_shared" ]; then
  echo "❌ Error: backend/functions/_shared not found"
  echo "   Create the _shared folder with crypto.ts, auth.ts, db.ts, types.ts"
  exit 1
fi

echo "📦 Copying _shared folder..."
cp -r backend/functions/_shared supabase/functions/_shared

# Copy function directories
echo "📦 Copying function directories..."
for func in encrypt-and-save fetch-and-decrypt; do
  if [ -d "backend/functions/$func" ]; then
    echo "  → $func"
    cp -r "backend/functions/$func" "supabase/functions/$func"
  else
    echo "  ⚠ Warning: $func not found"
  fi
done

echo ""
echo "✅ Functions prepared in supabase/functions/"
echo ""
echo "📋 Next steps:"
echo "   1. Make sure you're logged in: supabase login"
echo "   2. Link your project: supabase link --project-ref <your-project-ref>"
echo "   3. Set the encryption key secret:"
echo "      supabase secrets set APP_ENCRYPTION_KEY=<64-char-hex-key>"
echo ""
echo "   4. Deploy functions:"
echo "      supabase functions deploy encrypt-and-save"
echo "      supabase functions deploy fetch-and-decrypt"
echo ""
echo "   Or deploy all at once:"
echo "      supabase functions deploy"
