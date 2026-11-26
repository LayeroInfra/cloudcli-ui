# Download helpers shared by infra/vm/install.sh and companion/bin/install.sh.
# shellcheck shell=bash

# fetch_verified <url> <sha256|sha512> <hex> <dest>: download to dest only if the checksum matches.
fetch_verified() {
  local url="$1" algo="$2" want="$3" dest="$4" tmp got
  tmp="$(mktemp "${dest}.part.XXXXXX")"
  if ! curl -fsSL --retry 3 -o "$tmp" "$url"; then
    rm -f "$tmp"
    echo "download failed: $url" >&2
    return 1
  fi
  case "$algo" in
    sha256) got="$(shasum -a 256 "$tmp" 2>/dev/null || sha256sum "$tmp")" ;;
    sha512) got="$(shasum -a 512 "$tmp" 2>/dev/null || sha512sum "$tmp")" ;;
    *) rm -f "$tmp"; echo "unknown checksum $algo" >&2; return 1 ;;
  esac
  got="${got%% *}"
  if [ "$got" != "$want" ]; then
    rm -f "$tmp"
    echo "checksum mismatch for $url: got $got, want $want" >&2
    return 1
  fi
  mv "$tmp" "$dest"
}

# install_node <os-arch> <sha256>: unpack the pinned Node into ~/.local/lib/node-v<version>-<os-arch>.
install_node() {
  local platform="$1" sha="$2" dir ext archive
  dir="$HOME/.local/lib/node-v${NODE_VERSION}-${platform}"
  [ -x "$dir/bin/node" ] && return 0
  case "$platform" in linux-*) ext=tar.xz ;; *) ext=tar.gz ;; esac
  mkdir -p "$HOME/.local/lib"
  archive="$HOME/.local/lib/node-v${NODE_VERSION}-${platform}.${ext}"
  fetch_verified "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platform}.${ext}" sha256 "$sha" "$archive"
  tar -xf "$archive" -C "$HOME/.local/lib"
  rm -f "$archive"
}

# fetch_woodpecker_binary <name> <os_arch> <sha256> <dest>
fetch_woodpecker_binary() {
  local name="$1" platform="$2" sha="$3" dest="$4" work
  work="$(mktemp -d)"
  fetch_verified "https://github.com/woodpecker-ci/woodpecker/releases/download/v${WOODPECKER_VERSION}/woodpecker-${name}_${platform}.tar.gz" \
    sha256 "$sha" "$work/w.tgz"
  tar -xzf "$work/w.tgz" -C "$work" "woodpecker-${name}"
  install -m 755 "$work/woodpecker-${name}" "$dest"
  rm -rf "$work"
}
