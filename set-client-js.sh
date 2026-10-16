#!/bin/bash

# Script to set the @pipecat-ai/client-js dependency across the monorepo:
# the root package plus every workspace listed in package.json "workspaces".
#
# Usage: ./set-client-js.sh <version | package-spec | local-path>
# Examples:
#   ./set-client-js.sh 1.2.3                          # specific npm version
#   ./set-client-js.sh @pipecat-ai/client-js@1.2.3    # same thing
#   ./set-client-js.sh @pipecat-ai/client-js          # latest npm version
#   ./set-client-js.sh /path/to/local/client-js       # local checkout (file:)
#
# For each package, the dependency is updated in whichever sections it already
# appears (dependencies / devDependencies / peerDependencies), preserving the
# existing range prefix (^ or ~). Packages that don't depend on client-js are
# left untouched. Versions are written with `npm pkg set` (NOT `npm install
# --save-*`, which rewrites the dep in every section it appears in, clobbering
# the per-section range prefixes), then a single `npm install` at the end
# syncs the root lockfile.

set -e  # Exit on any error

PKG="@pipecat-ai/client-js"

# Always operate from the repo root (where this script lives) so the single
# workspace-root package-lock.json is the one that gets updated.
cd "$(dirname "$0")"

if [ $# -eq 0 ]; then
    echo "Error: Please provide a version, package spec, or local path"
    echo "Usage: $0 <version | package-spec | local-path>"
    echo ""
    echo "Examples:"
    echo "  $0 1.2.3                          # specific npm version"
    echo "  $0 $PKG@1.2.3                     # same thing"
    echo "  $0 /path/to/local/client-js       # local checkout (file:)"
    exit 1
fi

PACKAGE_SPEC="$1"

if [ -d "$PACKAGE_SPEC" ]; then
    VERSION="file:$(realpath "$PACKAGE_SPEC")"
    LOCAL_INSTALL=true
    echo "Using local client-js from: $PACKAGE_SPEC"
else
    # Accept either a bare version or a full package spec
    VERSION="${PACKAGE_SPEC#"$PKG"}"
    VERSION="${VERSION#@}"
    LOCAL_INSTALL=false
    if [ -z "$VERSION" ]; then
        VERSION=$(npm view "$PKG" version)
        echo "No version given; using latest from npm: $VERSION"
    fi
    echo "Setting $PKG to version: $VERSION"
fi

# Update $PKG in one section of one package, if it's already a dependency
# there. Preserves the existing ^/~ range prefix.
update_dep() {
    local dir="$1" section="$2"
    local current range

    current=$(node -p "((require('./${dir}/package.json').${section}) || {})['${PKG}'] || ''")
    [ -z "$current" ] && return 0

    if [ "$LOCAL_INSTALL" = true ]; then
        range="$VERSION"
    else
        case "$current" in
            "~"*) range="~${VERSION}" ;;
            *)    range="^${VERSION}" ;;
        esac
    fi

    if [ "$current" = "$range" ]; then
        echo "  ${section}: ${current} (unchanged)"
        return 0
    fi

    echo "  ${section}: ${current} -> ${range}"
    if [ "$dir" = "." ]; then
        npm pkg set "${section}.${PKG}=${range}"
    else
        npm pkg set "${section}.${PKG}=${range}" -w "$dir"
    fi
}

update_package() {
    local dir="$1"
    if [ ! -f "$dir/package.json" ]; then
        echo "Skipping $dir (no package.json found)"
        return 0
    fi
    echo "=== Updating $dir ==="
    for section in dependencies devDependencies peerDependencies; do
        update_dep "$dir" "$section"
    done
}

update_package "."

# Update every workspace listed in the root package.json (glob patterns like
# "transports/*" are expanded by the shell).
workspace_patterns=$(node -p "(require('./package.json').workspaces || []).join('\n')")
for pattern in $workspace_patterns; do
    for dir in $pattern; do
        update_package "$dir"
    done
done

echo "=== Syncing lockfile ==="
npm install

echo "=== Done ==="
