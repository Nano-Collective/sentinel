#!/usr/bin/env bash

# Catch-all gate for Sentinel. Runs the full test surface in the same order
# as CI. Exits on the first failure.
set -e

echo "🧪 Running all tests..."
echo ""

echo "📝 Checking code formatting..."
pnpm test:format
echo ""
echo "✅ Format check passed"
echo ""

echo "🔍 Checking TypeScript types..."
pnpm test:types
echo ""
echo "✅ Type check passed"
echo ""

echo "🔎 Running linter..."
pnpm test:lint
echo ""
echo "✅ Lint check passed"
echo ""

echo "🧩 Running AVA tests with coverage..."
pnpm test:ava:coverage
echo ""
echo "✅ Tests passed"
echo ""

echo "🗑️  Checking for unused code..."
pnpm test:knip
echo ""
echo "✅ Knip check passed"
echo ""

echo "🔒 Running dependency audit..."
pnpm test:audit
echo ""
echo "✅ Audit passed"
echo ""

echo "🛡️  Running Semgrep security scan..."
if command -v semgrep &> /dev/null; then
	pnpm test:security
	echo ""
	echo "✅ Security scan passed"
	echo ""
else
	echo "⚠️  Semgrep not installed - skipping security scan"
	echo "   Install with: pip install semgrep or brew install semgrep"
	echo ""
fi

echo "✅ Everything passes!"
