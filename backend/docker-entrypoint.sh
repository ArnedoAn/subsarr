#!/bin/sh
set -efu

fail_permissions() {
    echo >&2 "Subsarr cannot use $1 as UID:GID $(id -u):$(id -g). Grant this identity read/write access to app data and media; check host ownership/ACLs and Proxmox/LXC UID mapping. Configure PUID/PGID for root-started ownership migration of app data only."
    exit 1
}

settings_file=${SUBSYNC_SETTINGS_FILE_PATH:-/data/subsync.settings.json}
data_dir=${SUBSYNC_DATA_DIR:-$(dirname "$settings_file")}
database_file=${SUBSYNC_DATABASE_PATH:-$data_dir/subsarr.db}

if [ "$(id -u)" = 0 ]; then
    # Older Compose releases explicitly supplied 0:0; keep that legacy root path
    # without changing data ownership or unexpectedly selecting an unprivileged UID.
    if [ "${PUID:-}" = 0 ] && [ "${PGID:-}" = 0 ]; then
        unset PUID PGID
    fi
    if [ -n "${PUID:-}" ] || [ -n "${PGID:-}" ]; then
        case "${PUID:-}" in ''|*[!0-9]*) echo >&2 'PUID must be a nonzero numeric UID'; exit 1;; esac
        case "${PGID:-}" in ''|*[!0-9]*) echo >&2 'PGID must be a nonzero numeric GID'; exit 1;; esac
        if [ "$PUID" -eq 0 ] || [ "$PGID" -eq 0 ]; then
            echo >&2 'PUID and PGID must be nonzero; omit both only for legacy root operation.'
            exit 1
        fi
        case "$data_dir" in /*) ;; *) echo >&2 'App data directory must be absolute'; exit 1;; esac
        mkdir -p "$data_dir"
        safe_data=$(readlink -f "$data_dir")
        # Never recursively mutate application, operating-system, or media trees.
        case "$safe_data" in /data) ;; /|/app|/app/*|/media|/media/*|/etc|/etc/*|/usr|/usr/*|/bin|/bin/*|/sbin|/sbin/*|/proc|/proc/*|/sys|/sys/*|/dev|/dev/*|/var|/home|/root|/tmp|/mnt|/srv|/opt)
            echo >&2 "Unsafe app data ownership scope: $safe_data"; exit 1;; esac
        old_ifs=$IFS
        IFS=,
        for media_dir in ${SUBSYNC_MEDIA_DIRS:-/media}; do
            real_media=$(readlink -f "$media_dir") || { echo >&2 "Cannot resolve configured media root: $media_dir"; exit 1; }
            case "$safe_data/" in "$real_media/"*) echo >&2 'App data cannot overlap a media root'; exit 1;; esac
            case "$real_media/" in "$safe_data/"*) echo >&2 'Media root cannot be inside app data'; exit 1;; esac
        done
        IFS=$old_ifs
        # -h avoids dereferencing file symlinks; -R does not traverse directory symlinks.
        chown -R -h "$PUID:$PGID" "$safe_data"
        # Re-enter as the target identity to validate real access before launching Node.
        exec su-exec "$PUID:$PGID" /usr/local/bin/docker-entrypoint.sh "$@"
    fi
    echo >&2 'SECURITY WARNING: Subsarr is running as legacy root because PUID/PGID are unset. Set nonzero PUID/PGID to migrate app-data ownership and run unprivileged. Media ownership is never changed.'
    exec "$@"
fi

[ -d "$data_dir" ] && [ -r "$data_dir" ] && [ -w "$data_dir" ] && [ -x "$data_dir" ] || fail_permissions "$data_dir"
for file in "$database_file" "$settings_file" "$data_dir/subsarr-secret.key"; do
    if [ -e "$file" ]; then
        [ -f "$file" ] && [ -r "$file" ] && [ -w "$file" ] || fail_permissions "$file"
    fi
    parent=$(dirname "$file")
    [ -d "$parent" ] && [ -w "$parent" ] && [ -x "$parent" ] || fail_permissions "$parent"
done
old_ifs=$IFS
IFS=,
for media_dir in ${SUBSYNC_MEDIA_DIRS:-/media}; do
    [ -d "$media_dir" ] && [ -r "$media_dir" ] && [ -w "$media_dir" ] && [ -x "$media_dir" ] || fail_permissions "$media_dir"
done
IFS=$old_ifs
exec "$@"
