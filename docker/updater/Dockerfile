FROM docker:27-cli
ARG DEVFLOW_BUILD_VERSION=unknown
ARG DEVFLOW_BUILD_COMMIT=unknown
LABEL org.opencontainers.image.version="$DEVFLOW_BUILD_VERSION" \
      org.opencontainers.image.revision="$DEVFLOW_BUILD_COMMIT"
RUN apk add --no-cache bash ca-certificates coreutils curl git nodejs openssl python3 tar util-linux
WORKDIR /opt/devflow
ENTRYPOINT []
CMD ["bash", "/opt/devflow/app/scripts/updater-daemon.sh"]
