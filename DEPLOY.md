# Deploy — Monitor de Integração

O deploy roda **no servidor `192.168.56.113`** (onde há Docker, junto do R2P).
Este projeto sobe em containers próprios e portas dedicadas (web `8090`, api
`8091`), isolado do R2P.

> Não foi possível automatizar o deploy a partir do ambiente de
> desenvolvimento: a porta SSH 22 do `192.168.56.113` não está acessível de lá,
> não há Docker nessa máquina, e o ClickHouse `192.168.56.127` rejeita as
> credenciais `wagner/123`. Os passos abaixo são executados no servidor.

## Pré-requisitos no servidor
- Docker + Docker Compose v2 (`docker compose version`)
- `git`
- ClickHouse `192.168.56.127:8123` aceitando, de fato, o usuário/senha que
  você colocar no `.env` (hoje `wagner/123` retorna `AUTHENTICATION_FAILED` —
  crie/conceda o usuário no ClickHouse ou ajuste as credenciais).
- Os arquivos CSV de carga disponíveis para copiar para `./cargas`.

## Passos

```bash
# no 192.168.56.113
curl -fsSL https://raw.githubusercontent.com/wmarrane/webhookmonitor/main/deploy.sh -o deploy.sh
bash deploy.sh
# 1ª execução cria .env e PARA: ajuste os valores e rode de novo
nano ~/webhookmonitor/.env
#   CLICKHOUSE_URL=http://192.168.56.127:8123
#   CLICKHOUSE_USER=...      # usuário que autentica de verdade
#   CLICKHOUSE_PASSWORD=...
#   CLICKHOUSE_DB=monitor
#   VITE_API_BASE_URL=http://192.168.56.113:8091   # build-time, obrigatório
cp /caminho/dos/csvs/*.csv ~/webhookmonitor/cargas/
bash deploy.sh
```

## Resultado
- Frontend: `http://192.168.56.113:8090`
- API/health: `http://192.168.56.113:8091/api/health`
- Logs: `docker compose logs -f` (em `~/webhookmonitor`)

## Notas
- `VITE_API_BASE_URL` é **build-time**: alterá-lo exige `docker compose up -d
  --build` de novo.
- Reimportar o mesmo arquivo substitui os dados daquele arquivo (`source_file`).
- Classificação de status sucesso/erro ainda é `unknown` (decisão de design).
