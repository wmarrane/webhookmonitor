#!/usr/bin/env bash
# Deploy do Monitor de Integração — execute ESTE script NO servidor 192.168.56.113.
#
# Pré-requisitos no servidor:
#   - Docker + Docker Compose v2 (`docker compose version`)
#   - git
#   - Diretório com os CSVs (será montado como volume read-only em /cargas)
#   - ClickHouse acessível em CLICKHOUSE_URL aceitando o usuário/senha do .env
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/wmarrane/webhookmonitor/main/deploy.sh -o deploy.sh
#   bash deploy.sh
#
# Ou, se já clonou o repo: bash deploy.sh
set -euo pipefail

REPO_URL="https://github.com/wmarrane/webhookmonitor.git"
APP_DIR="${APP_DIR:-$HOME/webhookmonitor}"
BRANCH="${BRANCH:-main}"

echo ">> 1/5 Verificando pré-requisitos..."
command -v git >/dev/null || { echo "ERRO: git não instalado"; exit 1; }
docker --version >/dev/null || { echo "ERRO: docker não instalado"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERRO: docker compose v2 ausente"; exit 1; }

echo ">> 2/5 Obtendo o código (${BRANCH})..."
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo ">> 3/5 Configurando .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "   .env criado a partir de .env.example — AJUSTE os valores antes de continuar:"
  echo "     - CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD (devem autenticar de verdade)"
  echo "     - VITE_API_BASE_URL=http://192.168.56.113:8091  (build-time, obrigatório)"
  echo ""
  echo "   Edite e rode de novo:  nano $APP_DIR/.env  &&  bash deploy.sh"
  exit 2
fi

echo ">> 4/5 Garantindo o diretório ./cargas com os CSVs..."
mkdir -p "$APP_DIR/cargas"
if ! ls "$APP_DIR"/cargas/*.csv >/dev/null 2>&1; then
  echo "   AVISO: nenhum .csv em $APP_DIR/cargas — copie os arquivos de carga para lá."
  echo "   (o stack sobe mesmo assim; a importação fica sem arquivos até você copiá-los)"
fi

echo ">> 5/5 Subindo os containers (build)..."
docker compose up -d --build

echo ""
echo ">> Aguardando healthcheck da API..."
for i in $(seq 1 20); do
  if curl -fsS http://localhost:8091/api/health >/dev/null 2>&1; then
    echo "   API OK: $(curl -fsS http://localhost:8091/api/health)"
    break
  fi
  sleep 3
  [ "$i" = "20" ] && echo "   AVISO: /api/health não respondeu OK — verifique 'docker compose logs monitor-api' (provável: credenciais ClickHouse)."
done

echo ""
echo "Deploy concluído."
echo "  Frontend: http://192.168.56.113:8090"
echo "  API:      http://192.168.56.113:8091/api/health"
echo "Logs:       docker compose logs -f"
