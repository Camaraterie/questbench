#!/bin/bash
# Build the QuestBench image locally. Run from the repo root.
set -euo pipefail
TAG="${1:-questbench:local}"
docker build -f docker/Dockerfile -t "$TAG" .
echo "built $TAG"
