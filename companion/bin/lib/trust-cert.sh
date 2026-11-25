#!/bin/bash
# Trust the loopback certificate served through the selected workspace's SSH tunnel.
# shellcheck shell=bash

trust_workspace_cert() (
  cert="$(mktemp "${TMPDIR:-/tmp}/layero-workspace-cert.XXXXXX")" || return 1
  trap 'rm -f "$cert"' EXIT
  python3 - >"$cert" <<'PY' || return 1
import socket
import ssl

context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.check_hostname = False
context.verify_mode = ssl.CERT_NONE
with socket.create_connection(("127.0.0.1", 19443), timeout=5) as connection:
    with context.wrap_socket(connection) as gateway:
        print(ssl.DER_cert_to_PEM_cert(gateway.getpeercert(binary_form=True)), end="")
PY
  [ -s "$cert" ] || return 1

  fingerprint="$(openssl x509 -in "$cert" -outform DER | shasum -a 256 | awk '{print $1}')" || return 1
  marker="$IDENTITY_DIR/trusted-certs/$fingerprint"
  [ ! -f "$marker" ] || return 0

  security add-trusted-cert -r trustRoot -p ssl -s 127.0.0.1 \
    -k "$HOME/Library/Keychains/login.keychain-db" "$cert" >/dev/null 2>&1 || return 1
  mkdir -p "$(dirname "$marker")"
  touch "$marker"
)
