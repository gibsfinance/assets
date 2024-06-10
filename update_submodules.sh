#!/bin/bash

# Function to clone a submodule with retries
clone_submodule_with_retry() {
  local submodule_url=$1
  local submodule_path=$2
  local retries=3
  local count=0

  until [ "$count" -ge "$retries" ]; do
    git clone "$submodule_url" "$submodule_path" && break
    count=$((count + 1))
    echo "Clone failed. Attempt $count/$retries..."
    sleep 2
  done

  if [ "$count" -ge "$retries" ]; then
    echo "Failed to clone submodule after $retries attempts."
    exit 1
  fi
}

# Create the submodules directory if it doesn't exist
mkdir -p submodules

# Read submodules from .gitmodules and clone them
while IFS= read -r line; do
  if [[ $line =~ path\ =\ (.*) ]]; then
    submodule_path="${BASH_REMATCH[1]}"
  elif [[ $line =~ url\ =\ (.*) ]]; then
    submodule_url="${BASH_REMATCH[1]}"
    echo "Cloning submodule: $submodule_path from $submodule_url"
    clone_submodule_with_retry "$submodule_url" "$submodule_path"
  fi
done < .gitmodules

echo "Submodules updated successfully."
