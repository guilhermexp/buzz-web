# Base image for Buzz remote workspaces and managed agents (built by agent-control into the
# configured Docker daemon). Buzz binaries are bind-mounted read-only at /opt/buzz/bin.
FROM ubuntu:24.04
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates git less nano procps ripgrep socat \
  && rm -rf /var/lib/apt/lists/* \
  && usermod -l buzz -d /home/buzz -m ubuntu \
  && groupmod -n buzz ubuntu \
  && mkdir -p /workspace /opt/buzz/bin /run/buzz \
  && chown buzz:buzz /workspace
COPY buzz-ws-fs /usr/local/bin/buzz-ws-fs
RUN chmod 0755 /usr/local/bin/buzz-ws-fs
ENV PATH=/opt/buzz/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  LANG=C.UTF-8 \
  HOME=/home/buzz
USER 1000:1000
WORKDIR /workspace
