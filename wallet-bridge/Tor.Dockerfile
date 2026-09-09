FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e
RUN apt-get update && apt-get install --no-install-recommends -y tor=0.4.9.11-0+deb12u1 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node -m 0700 /var/lib/tor
COPY torrc /etc/tor/torrc
USER node
RUN tor --verify-config -f /etc/tor/torrc
EXPOSE 9050
ENTRYPOINT ["tor", "-f", "/etc/tor/torrc"]
