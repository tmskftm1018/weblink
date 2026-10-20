FROM node:22-bookworm-slim AS react-build
WORKDIR /build
RUN npm install --no-audit --no-fund esbuild@0.21.5 react@18.3.1 react-test-renderer@18.3.1
COPY apps/learning-runner/react-entry.js ./
RUN ./node_modules/.bin/esbuild react-entry.js --bundle --format=iife --global-name=__weblinkReact --define:process.env.NODE_ENV='"development"' --outfile=react-bundle.js \
    && node -e "require('fs').copyFileSync(require.resolve('@esbuild/linux-'+process.arch+'/bin/esbuild'), '/build/esbuild')"

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY infrastructure/learning-python/requirements.txt /opt/weblink/requirements.txt
RUN pip install --no-cache-dir -r /opt/weblink/requirements.txt \
    && pip install --no-cache-dir --only-binary=:all: python-quickjs-ng==0.12.1.1 \
    && useradd --uid 10001 --no-create-home learner \
    && mkdir -p /workspace /data && chown 10001:10001 /data
COPY infrastructure/learning-python/serve.py infrastructure/learning-python/check_api.py infrastructure/learning-python/check_sqlite.py /opt/weblink/
COPY infrastructure/learning-python/check_integration.py infrastructure/learning-python/integration-harness.js /opt/weblink/
COPY --from=react-build /build/react-bundle.js /opt/weblink/react-bundle.js
COPY --from=react-build /build/esbuild /usr/local/bin/esbuild
WORKDIR /workspace
USER 10001:10001
ENTRYPOINT []
