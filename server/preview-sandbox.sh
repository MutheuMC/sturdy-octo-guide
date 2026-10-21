#!/bin/sh
# Called by the preview worker with cwd/HOME set to its private temporary job dir.
# Requires Linux bubblewrap with unprivileged user namespaces enabled.
set -eu
job_dir="$PWD"
umask 077
# Bound individual file size and CPU time; execFile also enforces wall-clock timeout.
ulimit -f 131072
ulimit -t 80
set -- --die-with-parent --unshare-all --new-session --cap-drop ALL \
  --ro-bind /usr /usr --ro-bind /lib /lib --symlink usr/bin /bin \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$job_dir" "$job_dir" --chdir "$job_dir" \
  --setenv HOME "$job_dir" --setenv TMPDIR "$job_dir" "$@"
# Optional system configuration used by common LibreOffice distributions.
for system_path in /lib64 /etc/fonts /etc/ld.so.cache /etc/libreoffice; do
  if [ -e "$system_path" ]; then
    set -- --ro-bind "$system_path" "$system_path" "$@"
  fi
done
# Optional read-only runtime directory for a non-system LibreOffice installation.
if [ -n "${LIBREOFFICE_RUNTIME_DIR:-}" ]; then
  set -- --ro-bind "$LIBREOFFICE_RUNTIME_DIR" "$LIBREOFFICE_RUNTIME_DIR" "$@"
fi
exec /usr/bin/bwrap "$@"
