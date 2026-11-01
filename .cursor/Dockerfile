# Cloud Agent base: Node 22 + MySQL 8 (no systemd). Repo is checked out separately.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

ARG NODE_VERSION=22.14.0

# policy-rc.d exit 101: skip service starts during apt (no systemd in image builds).
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && chmod +x /usr/sbin/policy-rc.d \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        xz-utils \
        mysql-server \
        mysql-client \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/sbin/policy-rc.d \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
       | tar -xJ -C /usr/local --strip-components=1 --no-same-owner \
    && mkdir -p /var/run/mysqld /opt/hacien \
    && chown mysql:mysql /var/run/mysqld

# Vitest reads process.env at config load; this pulls gitignored .env into Node.
COPY load-env.cjs /opt/hacien/load-env.cjs
ENV NODE_OPTIONS=--require=/opt/hacien/load-env.cjs

USER ubuntu
