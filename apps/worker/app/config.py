import os

database_url = os.getenv("DATABASE_URL", "postgresql+psycopg://weblink:weblink@localhost:5432/weblink")
runtime_image = os.getenv("RUNTIME_IMAGE", "weblink-python-runtime:local")
run_timeout_seconds = int(os.getenv("RUN_TIMEOUT_SECONDS", "8"))
run_memory_mb = int(os.getenv("RUN_MEMORY_MB", "96"))
run_cpu_nanos = int(os.getenv("RUN_CPU_NANOS", "500000000"))
max_output_chars = int(os.getenv("RUN_MAX_OUTPUT_CHARS", "16384"))
worker_lease_seconds = int(os.getenv("WORKER_LEASE_SECONDS", "30"))
connection_encryption_key = os.getenv("CONNECTION_ENCRYPTION_KEY", "")
google_oauth_client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
google_oauth_client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
