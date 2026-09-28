FROM python:3.12-alpine
RUN addgroup -S -g 10001 runner && adduser -S -D -H -u 10001 -G runner runner \
    && mkdir -p /workspace /opt/weblink/lib \
    && chown runner:runner /workspace
COPY infrastructure/runtime/weblink_runner.py /opt/weblink/weblink_runner.py
COPY infrastructure/runtime/api_lab_server.py /opt/weblink/api_lab_server.py
COPY infrastructure/runtime/weblink_api.py /opt/weblink/lib/weblink_api.py
WORKDIR /workspace
USER 10001:10001
ENTRYPOINT []
