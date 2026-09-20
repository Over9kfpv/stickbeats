#!/usr/bin/env bash
# Repair an EdgeTX SD card (FAT) after an interrupted write. Run as root: sudo scripts/repair-sd.sh [/dev/sdXN]
# With no argument it picks the only removable vfat partition it finds.
# Backs up the card to ~/sd-backup-<timestamp>/ first (read-only mount), then unmounts, runs fsck.vfat and remounts.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0 $*" >&2; exit 1; }
command -v fsck.vfat >/dev/null || { echo "fsck.vfat missing (install dosfstools)" >&2; exit 1; }

dev="${1:-}"
if [ -z "$dev" ]; then
  mapfile -t cands < <(lsblk -rno NAME,FSTYPE,RM,TYPE | awk '$2=="vfat" && $3=="1" && $4=="part" {print "/dev/"$1}')
  [ "${#cands[@]}" -eq 1 ] || { echo "Found ${#cands[@]} removable vfat partitions (${cands[*]:-none}); pass one explicitly." >&2; exit 1; }
  dev="${cands[0]}"
fi
[ -b "$dev" ] || { echo "$dev is not a block device" >&2; exit 1; }
[ "$(lsblk -no RM "$dev" | head -1 | tr -d ' ')" = "1" ] || { echo "$dev is not removable; refusing." >&2; exit 1; }
echo "Repairing $dev ($(lsblk -no SIZE "$dev" | head -1 | tr -d ' '), UUID $(blkid -s UUID -o value "$dev"))"

user="${SUDO_USER:-root}"; home="$(getent passwd "$user" | cut -d: -f6)"
backup="$home/sd-backup-$(date +%Y%m%d-%H%M%S)"

# 1. unmount whatever has it
while read -r mp; do
  [ -n "$mp" ] || continue
  echo "Unmounting $mp"
  if ! umount "$mp"; then
    echo "Busy. These processes are using the card (close them or 'cd ~' in that terminal, then rerun):" >&2
    fuser -vm "$mp" >&2 || true
    exit 1
  fi
done < <(lsblk -rno MOUNTPOINT "$dev" | sed '/^$/d')

# 2. backup what can still be read (read-only, so nothing more is damaged)
tmp="$(mktemp -d)"
if mount -o ro "$dev" "$tmp" 2>/dev/null; then
  echo "Backing up to $backup (errors on damaged files are ignored)"
  mkdir -p "$backup"; cp -a "$tmp"/. "$backup"/ 2>/dev/null || true
  chown -R "$user": "$backup" 2>/dev/null || true
  umount "$tmp"
else
  echo "Could not mount read-only; skipping backup." >&2
fi
rmdir "$tmp"

# 3. repair: -a automatic, -w write changes; exit 0/1 = ok/fixed
set +e; fsck.vfat -a -w -v "$dev"; rc=$?; set -e
case $rc in 0) echo "Filesystem was clean.";; 1) echo "Filesystem errors were repaired.";; *) echo "fsck.vfat exit code $rc: not fully repaired. Backup is in $backup"; exit "$rc";; esac
sync

# 4. remount for the desktop user
if command -v udisksctl >/dev/null && [ "$user" != root ]; then
  sudo -u "$user" udisksctl mount -b "$dev" || true
fi
echo "Done. Backup: $backup"
echo "Now retry the install, wait for 'Wrote N sounds', then EJECT the drive before unplugging."
