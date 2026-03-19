#!/bin/sh
set -e

# Clone a submodule with retries
clone_submodule_with_retry() {
  url="$1"
  path="$2"
  retries=3
  count=0

  until [ "$count" -ge "$retries" ]; do
    rm -rf "$path"
    if git clone "$url" "$path"; then
      return 0
    fi
    count=$((count + 1))
    echo "Clone failed. Attempt $count/$retries..."
    sleep 2
  done

  echo "Failed to clone submodule after $retries attempts."
  exit 1
}

mkdir -p submodules

# Parse .gitmodules and clone each submodule
submodule_path=""
while IFS= read -r line; do
  case "$line" in
    *"path = "*)
      submodule_path="${line#*path = }"
      submodule_path="$(echo "$submodule_path" | tr -d '[:space:]')"
      ;;
    *"url = "*)
      submodule_url="${line#*url = }"
      submodule_url="$(echo "$submodule_url" | tr -d '[:space:]')"
      if [ -n "$submodule_path" ] && [ -n "$submodule_url" ]; then
        echo "Cloning submodule: $submodule_path from $submodule_url"
        clone_submodule_with_retry "$submodule_url" "$submodule_path"
      fi
      ;;
  esac
done < .gitmodules

echo "Submodules updated successfully."
