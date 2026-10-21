# SiteGuard

Piattaforma agent per monitorare siti **WordPress / Joomla**: aggiornamenti, integrity file, segnali di compromissione. L’utente decide se far eseguire l’intervento all’AI o farlo manualmente.

Pensata per deploy su **Vercel** (UI + API) con job asincroni via **Inngest** e DB **Postgres** (Neon) in produzione.

## Architettura

```
Vercel (Next.js)
  ├── Dashboard / API
  ├── Credenziali cifrate (AES-256-GCM)
  └── Inngest webhook
        └── Worker scan:
              ├── API CMS (utenti, settings, plugin/update)
              └── SFTP (malware su filesystem, cleanup)
```

## Database

Usa Postgres remoto (Firewall SRL) via `DATABASE_URL` (Prisma) e opzionalmente PostgREST:

- `NEXT_PUBLIC_REST_URL` + `NEXT_PUBLIC_ANON_KEY` (client)
- `SERVICE_ROLE_KEY` (solo server)

Tabelle: `sites`, `scans`, `findings`, `actions`, `audit_logs`.

## Quick start (locale)

```bash
cp .env.example .env   # inserisci DATABASE_URL e chiavi REST
npm install
npx prisma db push
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000).

Con `DEMO_SCAN=true` (default) puoi aggiungere un sito **senza** credenziali e avviare uno scan: vengono generati finding di esempio (update, malware, admin sospetto, siteurl hijack). Su ogni finding:

- **Esegui con AI** — approva e simula l’applicazione
- **Faccio io** — mostra la checklist
- **Ignora**

## Credenziali reali

Nel form “Nuovo sito”:

| Canale | Uso |
|--------|-----|
| **API CMS** | Utenti admin, settings/siteurl, inventario plugin e update |
| **SFTP** | Scan PHP in `uploads`, pattern malware, delete/quarantena file |

Le secret sono cifrate con `CREDENTIALS_SECRET` prima di finire nel DB.

Per scan live: `DEMO_SCAN=false` e almeno API o SFTP compilati.

## Vercel

1. Crea un DB Neon e imposta `DATABASE_URL` (postgres).
2. In `prisma/schema.prisma` cambia `provider = "postgresql"`.
3. `npx prisma db push` (o migrate).
4. Variabili: `CREDENTIALS_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `DEMO_SCAN=false`.
5. Collega Inngest all’app (`/api/inngest`).
6. Deploy su Vercel.

Senza Inngest lo scan gira in-process nella Route Handler (ok in locale; su Vercel preferisci Inngest per i timeout).

## Roadmap

- [ ] Handler live: update plugin WP via REST, delete file via SFTP
- [ ] Backup automatico pre-write su R2/S3
- [ ] Auth multi-tenant (Clerk)
- [ ] Cron scan giornaliero Inngest
- [ ] Feed CVE / WPScan
- [ ] Allowlist IP worker SFTP

## Stack

Next.js 16 · Prisma · SQLite (dev) / Postgres (prod) · Inngest · ssh2-sftp-client · Zod
