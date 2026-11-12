FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS node
FROM rust:1.94.1-bookworm@sha256:6ae102bdbf528294bc79ad6e1fae682f6f7c2a6e6621506ba959f9685b308a55
RUN printf 'Types: deb\nURIs: https://snapshot.debian.org/archive/debian/20260407T000000Z/\nSuites: bookworm\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' > /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get -o Acquire::Check-Valid-Until=false install --no-install-recommends -y clang-14=1:14.0.6-12 lld-14=1:14.0.6-12 \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown \
    && cargo install --locked wasm-bindgen-cli --version 0.2.114
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get -o Acquire::Check-Valid-Until=false install --no-install-recommends -y llvm-14=1:14.0.6-12 \
    && rm -rf /var/lib/apt/lists/*
ENV CC_wasm32_unknown_unknown=clang-14
ENV AR_wasm32_unknown_unknown=llvm-ar-14
WORKDIR /wallet
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY build-in-container.sh wasm-smoke.mjs README.md ./
RUN sh /wallet/build-in-container.sh
COPY regtest.mjs wasm-protocol.mjs ./
CMD ["node", "--experimental-default-type=module", "/wallet/wasm-smoke.mjs"]
