#!/bin/sh

# Default to root if PUID/PGID are not set
PUID=${PUID:-0}
PGID=${PGID:-0}

if [ "$PUID" -ne 0 ] || [ "$PGID" -ne 0 ]; then
    echo "Running with PUID=$PUID and PGID=$PGID"
    
    # Create group if not exists
    if ! getent group subsarr >/dev/null 2>&1; then
        addgroup -g "$PGID" subsarr
    fi
    
    # Create user if not exists
    if ! getent passwd subsarr >/dev/null 2>&1; then
        adduser -u "$PUID" -G subsarr -D -H -s /bin/sh subsarr
    fi
    
    # Ensure /data exists and change ownership
    mkdir -p /data
    chown -R "$PUID":"$PGID" /app
    chown -R "$PUID":"$PGID" /data
    
    # Execute the command as the new user
    exec su-exec "$PUID":"$PGID" "$@"
else
    # Execute as root
    exec "$@"
fi
