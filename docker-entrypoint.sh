#!/bin/sh
set -eu

cache="${FONT_CACHE_DIR:-/app/data/cache}"
if [ "$cache" = "/" ] || [ -L "$cache" ]; then
    echo "linxie: font cache directory cannot be / or a symbolic link: $cache" >&2
    exit 1
fi

if [ "$(id -u)" = "0" ]; then
    if ! mkdir -p -- "$cache" || ! chown --no-dereference node:node -- "$cache" || ! chmod u+rwx -- "$cache"; then
        echo "linxie: cannot initialize font cache directory: $cache; check that the mount is writable" >&2
        exit 1
    fi
    exec setpriv --reuid=node --regid=node --init-groups --no-new-privs -- "$0" "$@"
fi

if [ ! -d "$cache" ] || [ ! -r "$cache" ] || [ ! -w "$cache" ] || [ ! -x "$cache" ]; then
    echo "linxie: font cache directory is not writable for uid $(id -u): $cache" >&2
    exit 1
fi
exec setpriv --no-new-privs -- "$@"
