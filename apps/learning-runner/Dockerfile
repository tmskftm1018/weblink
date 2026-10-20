FROM node:22-bookworm-slim AS react-build
WORKDIR /build
RUN npm install --no-audit --no-fund esbuild@0.21.5 react@18.3.1 react-test-renderer@18.3.1
COPY react-entry.js ./
RUN ./node_modules/.bin/esbuild react-entry.js --bundle --format=iife --global-name=__weblinkReact --define:process.env.NODE_ENV='"development"' --outfile=react-bundle.js \
    && node -e "require('fs').copyFileSync(require.resolve('@esbuild/linux-'+process.arch+'/bin/esbuild'), '/build/esbuild')"

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --only-binary=:all: -r requirements.txt \
    && useradd --uid 10001 --no-create-home runner
COPY server.py execute.py harness.js react-harness.js execute_react.py ./
COPY --from=react-build /build/react-bundle.js /app/react-bundle.js
COPY --from=react-build /build/esbuild /usr/local/bin/esbuild
USER 10001:10001
CMD ["python", "-I", "/app/server.py"]
