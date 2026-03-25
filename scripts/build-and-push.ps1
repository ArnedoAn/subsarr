$ErrorActionPreference = 'Stop'

if (-not $env:SUBSYNC_REGISTRY) {
  throw 'SUBSYNC_REGISTRY is required'
}

$apiImage = if ($env:SUBSYNC_API_IMAGE) { $env:SUBSYNC_API_IMAGE } else { 'subsync-api' }
$webImage = if ($env:SUBSYNC_WEB_IMAGE) { $env:SUBSYNC_WEB_IMAGE } else { 'subsync-web' }
$tag = if ($env:SUBSYNC_TAG) { $env:SUBSYNC_TAG } else { 'latest' }

$apiRef = "$($env:SUBSYNC_REGISTRY)/$apiImage:$tag"
$webRef = "$($env:SUBSYNC_REGISTRY)/$webImage:$tag"

docker build -t $apiRef "./backend"
docker build -t $webRef "./frontend"

docker push $apiRef
docker push $webRef
