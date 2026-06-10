FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
# .npmrc carries legacy-peer-deps (the ajv@8 pin needs it); npm ci installs the
# exact committed lockfile identically on every teammate's machine.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Voice capture (on-device STT) needs whisper.cpp's whisper-cli. Compiled from
# source so the image is correct per-arch (arm64 on Apple Silicon, x86 on a
# colleague's PC) instead of shipping an arch-locked prebuilt binary. ffmpeg
# (apt, in the runner) decodes the browser's webm/opus before whisper sees it.
FROM debian:bookworm-slim AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
    git cmake build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
ARG WHISPER_TAG=v1.8.6
RUN git clone --depth 1 --branch ${WHISPER_TAG} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# GGML_NATIVE=OFF: the conservative CPU baseline #ifdefs out the FP16 NEON path
# that GCC 12 on aarch64 can't inline ("target specific option mismatch"), and
# keeps the build arch-agnostic (no per-arch -march). Voice clips are short, so
# the lost SIMD acceleration is immaterial.
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
 && cmake --build build -j --target whisper-cli
# Gather the binary + the shared libs it links into one clean tree to copy over.
RUN mkdir -p /out/bin /out/lib \
 && cp build/bin/whisper-cli /out/bin/ \
 && find build -name '*.so*' -exec cp -P {} /out/lib/ \;

FROM base AS run
ENV NODE_ENV=production
# ffmpeg decodes audio; libgomp1 is whisper-cli's OpenMP runtime dep.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /out/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /out/lib/ /usr/local/lib/whisper/
# whisper-cli + ffmpeg present in-container, model mounted at /models (compose).
ENV LD_LIBRARY_PATH=/usr/local/lib/whisper \
    WHISPER_BIN=/usr/local/bin/whisper-cli \
    FFMPEG_BIN=ffmpeg \
    WHISPER_MODEL=/models/ggml-base.en.bin
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Belt-and-suspenders for Windows checkouts that predate .gitattributes: a CRLF
# entrypoint fails as "/bin/sh^M: bad interpreter" inside the container.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
