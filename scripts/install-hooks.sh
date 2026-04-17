#!/bin/sh
# Git hooks installer
# Run this to install hooks from the repository into .git/hooks/

echo "Installing git hooks..."

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Copy hooks from repo to .git/hooks
cp -f scripts/hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

echo "✅ Git hooks installed successfully!"
echo "The pre-commit hook will now run lint, typecheck, and build before each commit."