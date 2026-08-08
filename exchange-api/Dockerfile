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

RUN mkdir -p data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
