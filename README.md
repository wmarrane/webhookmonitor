# Monitor de Integração NetSuite

Stack standalone (separada do R2P) para monitorar requests de integração do
NetSuite a partir de CSVs em `./cargas`.

## Componentes
- `apps/api` — Fastify + ingestão streaming + ClickHouse client (porta 8091)
- `apps/web` — React 19 + Vite + Tailwind 4 (porta 8090, Nginx)
- ClickHouse: **externo, já existente** em 192.168.56.127 (não provisionado aqui)

## Rodar
1. `copy .env.example .env` e ajuste valores.
2. Coloque o CSV em `./cargas/`.
3. `docker compose up -d --build`
4. Acesse `http://192.168.56.113:8090` (ou `http://localhost:8090` localmente).
5. Aba **Importação** → escolher arquivo → **Importar** → acompanhar progresso.

## Desenvolvimento
- `npm install`
- `npm test` (api + web)
- `npm run dev:api` / `npm run dev:web`

## Notas
- A regra de classificação de status (sucesso/erro) ainda não está definida;
  `status` é gravado como `unknown`.
- Reimportar o mesmo arquivo substitui os dados daquele arquivo (`source_file`).
- `VITE_API_BASE_URL` é **build-time** e obrigatório: deve apontar para a URL
  do `apps/api` acessível pelo navegador (ex.: `http://192.168.56.113:8091`).
  Se vazio, o front faz chamadas same-origin (`:8090`) e a API não responde.
  Alterá-lo exige rebuild da imagem web (`docker compose up -d --build`).
- O ClickHouse em 192.168.56.127 deve aceitar o usuário/senha do `.env`.
  Se a autenticação falhar (AUTHENTICATION_FAILED), crie/conceda o usuário
  no servidor ou ajuste as credenciais antes de importar.
