# Build context is the REPO ROOT, not exchange-api/, because registry.json
# lives at the root and the image needs its own copy — a container has no repo
# checkout for app/registry.py's relative fallback to walk up to.
#   docker build -f exchange-api/Dockerfile -t agent-exchange-api .
FROM python:3.12-slim
WORKDIR /app

COPY exchange-api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY exchange-api/ .

# registry.json stays the single source of truth at the repo root; this copies
# it in at build time rather than forking a second one into exchange-api/.
COPY registry.json /app/registry.json
ENV REGISTRY_PATH=/app/registry.json

# Run as a dedicated non-root user. /app/data must be owned by it so SQLite
# can write; docker-compose mounts a named volume there, which inherits this
# ownership on first use (a host bind mount would stay root-owned and break).
RUN useradd --system --uid 10001 appuser \
    && mkdir -p data \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
