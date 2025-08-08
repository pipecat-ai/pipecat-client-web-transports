#!/bin/bash

# Script to set client-js package across project directories
# Usage: ./set-client-js.sh <package-spec>
# Examples:
#   ./set-client-js.sh /path/to/local/client-js     # Install from local path
#   ./set-client-js.sh @pipecat-ai/client-js        # Install from npm
#   ./set-client-js.sh @pipecat-ai/client-js@1.2.3  # Install specific version

set -e  # Exit on any error

# Check if package spec argument is provided
if [ $# -eq 0 ]; then
    echo "Error: Please provide a package specification"
    echo "Usage: $0 <package-spec>"
    echo ""
    echo "Examples:"
    echo "  $0 /path/to/local/client-js        # Install from local path"
    echo "  $0 1.2.3                           # Install specific version"
    exit 1
fi

PACKAGE_SPEC="$1"

# Determine if this is a local path or npm package
if [ -d "$PACKAGE_SPEC" ]; then
    # It's a local directory
    PACKAGE_SPEC=$(realpath "$PACKAGE_SPEC")
    INSTALL_SPEC="@pipecat-ai/client-js@file:$PACKAGE_SPEC"
    LOCAL_INSTALL=true
    echo "Installing local client-js from: $PACKAGE_SPEC"
else
    # It's an npm package spec
    INSTALL_SPEC="$PACKAGE_SPEC"
    LOCAL_INSTALL=false
    echo "Installing client-js package: $PACKAGE_SPEC"
fi

# Function to install in a directory
install_in_dir() {
    local dir="$1"
    if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
        echo "Installing in: $dir"
        cd "$dir"
        if [ "$LOCAL_INSTALL" = true ]; then
            # Use local path installation
            npm install "$INSTALL_SPEC"
        else
            if [[ "$dir" == *"transports"* ]]; then
                # Install as peer and dev dependency in transport directories
                npm install --save-peer "@pipecat-ai/client-js@~$INSTALL_SPEC"
                npm install --save-dev "@pipecat-ai/client-js@^$INSTALL_SPEC"
            else
                # Use npm package installation
                npm install "@pipecat-ai/client-js@^$INSTALL_SPEC"
            fi
        fi
        cd - > /dev/null
    else
        echo "Skipping $dir (no package.json found)"
    fi
}

# Install in top-level directory
echo "=== Installing in top-level directory ==="
install_in_dir "."

# Install in all transport directories
echo "=== Installing in transport directories ==="
for transport_dir in transports/*/; do
    if [ -d "$transport_dir" ]; then
        install_in_dir "$transport_dir"
    fi
done

# Install in all example directories
echo "=== Installing in example directories ==="
for example_dir in examples/*/; do
    if [ -d "$example_dir" ]; then
        install_in_dir "$example_dir"
    fi
done

echo "=== Installation complete! ==="
echo "Package specification used: $INSTALL_SPEC"