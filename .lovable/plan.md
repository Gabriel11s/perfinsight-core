

# Implementar OAuth GoHighLevel (Marketplace App)

## Como funciona o fluxo OAuth do GHL

```text
Usuario clica "Conectar GHL"
        |
        v
Redireciona para GHL Auth URL
(com client_id, redirect_uri, scopes)
        |
        v
Usuario autoriza no GHL
        |
        v
GHL redireciona de volta para /ghl/callback?code=XXXX
        |
        v
Edge Function troca code por access_token + refresh_token
        |
        v
Salva tokens no banco (tabela ghl_oauth_tokens)
        |
        v
sync-ghl-names usa os tokens salvos (sem webhook n8n)
```

## Pre-requisitos (voce precisa fazer no GHL)

1. Acessar **marketplace.gohighlevel.com** > My Apps > Criar App
2. Na aba **Auth**, configurar:
   - **Redirect URL**: `https://vgnhqycgfbuyyrsrwjxr.supabase.co/functions/v1/ghl-oauth-callback`
   - **Scopes**: `locations.readonly`, `users.readonly`
3. Copiar o **Client ID** e **Client Secret** gerados

## O que sera implementado

### 1. Tabela `ghl_oauth_tokens`
Armazena os tokens OAuth do GHL por tenant.

| Coluna | Tipo |
|---|---|
| tenant_id | uuid (PK, FK tenants) |
| access_token | text |
| refresh_token | text |
| expires_at | timestamptz |
| location_id | text |
| updated_at | timestamptz |

### 2. Edge Function `ghl-oauth-callback`
Nova edge function que recebe o redirect do GHL com o `code` e:
- Troca o `code` por `access_token` + `refresh_token` via POST para `https://services.leadconnectorhq.com/oauth/token`
- Salva os tokens na tabela `ghl_oauth_tokens`
- Redireciona o usuario de volta para `/settings?ghl=connected`

### 3. Secrets necessarios
- `GHL_CLIENT_ID` - Client ID do app no marketplace
- `GHL_CLIENT_SECRET` - Client Secret do app no marketplace

### 4. Atualizar `sync-ghl-names`
Trocar a funcao `getGhlToken()` que usa webhook n8n para buscar o token diretamente da tabela `ghl_oauth_tokens`. Se o token estiver expirado, usa o `refresh_token` para renovar automaticamente.

### 5. Atualizar Settings Page
- Adicionar botao **"Conectar GoHighLevel"** que abre a URL de autorizacao:
  ```
  https://marketplace.gohighlevel.com/oauth/chooselocation
    ?response_type=code
    &redirect_uri=https://vgnhqycgfbuyyrsrwjxr.supabase.co/functions/v1/ghl-oauth-callback
    &client_id={GHL_CLIENT_ID}
    &scope=locations.readonly users.readonly
  ```
- Mostrar status de conexao (conectado/desconectado) baseado na existencia do token na tabela
- Detectar `?ghl=connected` na URL para mostrar toast de sucesso

### 6. Frontend: pagina de callback (opcional)
A redirect URL aponta para a edge function, entao nao precisa de pagina no frontend. A edge function faz o trabalho e redireciona para `/settings`.

## Resumo de arquivos

| Arquivo | Acao |
|---|---|
| Migration SQL | Criar tabela `ghl_oauth_tokens` com RLS |
| `supabase/functions/ghl-oauth-callback/index.ts` | Criar - recebe code, troca por tokens, salva |
| `supabase/functions/sync-ghl-names/index.ts` | Atualizar - usar tokens do banco ao inves de webhook |
| `src/pages/Settings.tsx` | Atualizar - botao conectar GHL + status |
| `src/hooks/use-tracker-data.ts` | Adicionar query para checar status da conexao |
| `supabase/config.toml` | Adicionar `ghl-oauth-callback` com `verify_jwt = false` |

## Detalhes tecnicos

### Token refresh automatico
O `access_token` do GHL expira em ~24h. O `sync-ghl-names` vai verificar o `expires_at` e, se expirado, usar o `refresh_token` para obter um novo par de tokens antes de fazer as chamadas da API.

### Seguranca
- Tokens ficam no banco com RLS (apenas o tenant dono acessa)
- `ghl-oauth-callback` valida o `state` parameter para prevenir CSRF
- Client Secret fica como Supabase Secret, nunca no frontend

