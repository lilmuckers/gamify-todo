# Quest Log local editor: serves the app and a git-backed API over a mounted repo.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY schema schema
COPY skills skills
COPY shared shared
COPY app app
COPY server server
RUN npm run build:local && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
RUN apk add --no-cache git openssh-client \
  # The repo is bind-mounted and owned by the host user.
  && git config --system --add safe.directory '*' \
  # HTTPS remotes: authenticate pushes with GITHUB_TOKEN when it is set.
  && git config --system credential.helper \
     '!f() { test -n "$GITHUB_TOKEN" && echo username=x-access-token && echo "password=$GITHUB_TOKEN"; }; f'
WORKDIR /opt/quest
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules node_modules
COPY --from=build /src/shared shared
COPY --from=build /src/server server
COPY --from=build /src/app/package.json app/package.json
COPY --from=build /src/app/dist app/dist
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    REPO_DIR=/repo \
    STATIC_DIR=/opt/quest/app/dist \
    GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- --header "Host: localhost" http://127.0.0.1:8080/api/status >/dev/null || exit 1
CMD ["node", "--import", "tsx", "server/src/index.ts"]
