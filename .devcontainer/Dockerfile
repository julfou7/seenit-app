FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

ARG ACTIONLINT_VERSION=1.7.12

USER root

RUN set -eux; \
    npm install --global npm@10.9.3; \
    deb_arch="$(dpkg --print-architecture)"; \
    case "$deb_arch" in \
      amd64) actionlint_arch='amd64' ;; \
      arm64) actionlint_arch='arm64' ;; \
      *) echo "Architecture actionlint non supportée: $deb_arch" >&2; exit 1 ;; \
    esac; \
    archive="actionlint_${ACTIONLINT_VERSION}_linux_${actionlint_arch}.tar.gz"; \
    base_url="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}"; \
    curl -fsSLo "/tmp/${archive}" "${base_url}/${archive}"; \
    curl -fsSLo /tmp/actionlint-checksums.txt "${base_url}/actionlint_${ACTIONLINT_VERSION}_checksums.txt"; \
    grep "  ${archive}$" /tmp/actionlint-checksums.txt | sed 's#  #  /tmp/#' | sha256sum --check --strict; \
    tar -xzf "/tmp/${archive}" -C /tmp actionlint; \
    install -m 0755 /tmp/actionlint /usr/local/bin/actionlint; \
    rm -f "/tmp/${archive}" /tmp/actionlint /tmp/actionlint-checksums.txt; \
    node --version; \
    npm --version; \
    actionlint -version

USER node
