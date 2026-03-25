#!/usr/bin/env sh
set -eu

REGISTRY="${SUBSYNC_REGISTRY:?SUBSYNC_REGISTRY is required}"
API_IMAGE="${SUBSYNC_API_IMAGE:-subsync-api}"
WEB_IMAGE="${SUBSYNC_WEB_IMAGE:-subsync-web}"
TAG="${SUBSYNC_TAG:-latest}"

docker build -t "${REGISTRY}/${API_IMAGE}:${TAG}" "./backend"
docker build -t "${REGISTRY}/${WEB_IMAGE}:${TAG}" "./frontend"

docker push "${REGISTRY}/${API_IMAGE}:${TAG}"
docker push "${REGISTRY}/${WEB_IMAGE}:${TAG}"
