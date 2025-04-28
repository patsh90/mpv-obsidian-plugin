#!/bin/bash

# Build the plugin
echo "Building plugin..."
bun install
bun run build

# Get timestamp for the zip file
TIMESTAMP=$(date +"%Y%m%d%H%M%S")

# Create the release zip file
echo "Creating release zip..."
zip "release_${TIMESTAMP}.zip" main.js manifest.json styles.css

echo "Build completed successfully!"
echo "Release package: release_${TIMESTAMP}.zip"