# Company Assistant Web

AI-assisted field operations platform for service and maintenance companies, combining role-based dashboards, work orders, reminders, and a Codex-powered assistant available in the app, WhatsApp, and iMessage.
## Screenshots

## Screenshots

### Dashboard

![Dashboard](./public/screenshot-dashboard.png)

### Assistant

![Assistant](./public/screenshot-assistant.png)

## What it is

This app is designed as an operational system for service businesses, where technicians, owners, and admins can manage daily work through dashboards and assistant-driven workflows across the web app, WhatsApp, and iMessage.

It supports roles such as:

1. admin
2. owner
3. operator
4. technician

The goal is to connect dashboards, work orders, daily reporting, reminders, and assistant workflows into a single system.

## What is already included

1. Prisma schema in `prisma/schema.prisma`
2. generated Prisma client in `src/generated/prisma`
3. Auth0-ready scaffold in `proxy.ts` and `src/shared/auth/*`
4. internal user model with role and permission layer
5. role-based pages:

   1. `/admin`
   2. `/admin/users`
   3. `/owner`
   4. `/operator`
   5. `/technician`
6. `/login` for local sign-in
7. API routes:

   1. `GET /api/health`
   2. `GET /api/auth/session`
   3. `POST /api/auth/login`
   4. `POST /api/auth/logout`
   5. `POST /api/auth/sync-user`
   6. `GET /api/admin/users`
   7. `POST /api/admin/users`
   8. `GET /api/work-orders`
   9. `GET /api/daily-report`
   10. `GET /api/whatsapp/webhook`
   11. `POST /api/whatsapp/webhook`

## Local development

1. Configure environment variables based on `.env.example`
2. For local development, the default setup uses file-backed database mode with `PGlite`
3. If you are not using Auth0 yet, the app can bootstrap a local admin from the `BOOTSTRAP_ADMIN_*` environment variables that you define in `.env.local`
4. Run:

```bash
npm run db:generate
npm run dev
```

5. Open the app at `http://localhost:3000`

## How the app runs

`npm run dev` follows the real local runtime flow:

1. checks or creates the file-backed database
2. builds the application for production
3. starts the server with `next start`

This is the recommended command when you want to run the app the way it actually works with its database.

If you want hot-reload watch mode for engineering and debugging, there is also:

```bash
npm run dev:watch
```

`dev:watch` is experimental and may not be fully stable with local `PGlite`.

## Prisma 7 notes

1. The project uses `prisma.config.ts`
2. The datasource URL is defined in the config and not in the schema
3. For local development, `PGlite` is used with file-backed storage in `.data/pglite`
4. `npm run db:push` creates the schema from the Prisma datamodel and applies it to the local database
5. For production or external databases, `pg` and `@prisma/adapter-pg` remain available

## Useful commands

```bash
npm run lint
npm run build
npm run db:format
npm run db:generate
npm run db:validate
npm run db:push
```

## Public use note

This repository is a reference implementation for local development and product architecture exploration.

To run it correctly:

1. create your own `.env.local` based on `.env.example`
2. define your own local admin credentials
3. use your own tokens and integration settings where needed

## Next engineering slice

1. Technician write UI for time, materials, and follow-up
2. Assistant message persistence and tool gating
3. WhatsApp ingestion into the same domain model
4. Auth0 callback and internal user sync for production sign-in
5. PostgreSQL deployment wiring and migrations flow
6. ## Screenshots
