# MIATA — Setup

**You need:** Node.js 20.19+ and PostgreSQL 14+ (with pgAdmin 4), with PostgreSQL running.

The application uses one database, **`miata_live_db`**. (`npm test` creates its own throwaway `miata_test_db`; the
application never uses it.)

| Database files | Purpose |
|---|---|
| `database/migrations/*.sql` | The schema, applied in order by `npm run migrate` |
| `database/seed/` | Seed data: one JSON file per table in `tables/`, sample videos and payment proofs in `uploads/` (`npm run db:seed`) |
| `database/miata_live_db.sql` | Schema + seed data in one SQL script, for pgAdmin or psql (`npm run db:script` regenerates it) |

## 1. Set up the API

```bash
cd C:\MIATA\miata_api
npm install
Copy-Item .env.example .env
```

Open `miata_api/.env` and set:
- `DB_PASSWORD` — your PostgreSQL password
- `JWT_SECRET` — generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- E-mail (recommended): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` — your mail
  server. New students and professors get a welcome e-mail with a link to set their password, and students are e-mailed
  online class invitations, changes and cancellations. `APP_TIMEZONE` (e.g. `Asia/Kolkata`) sets the time zone used in
  e-mails. Without SMTP nothing is e-mailed: give each new account a temporary password when you create it.

## 2. Create the database

```bash
npm run db:setup        # creates miata_live_db and applies the migrations
npm run db:seed         # optional: loads the seed data (sample accounts, courses, batches, fees, videos …)
npm run create-admin    # creates your own admin login
```

`npm run db:seed` only loads into a new database (empty, or holding only admins made with `create-admin`) and never
changes existing data. **Or** do it all in pgAdmin instead: create `miata_live_db`, open its Query Tool, open
`database/miata_live_db.sql` and Execute; then copy `database/seed/uploads/*` into `uploads/` and run `npm run create-admin`.

## 3. Set up the web

```bash
cd C:\MIATA\miata_web
npm install
```

## 4. Run both (two terminals)

**Terminal 1 — API**
```bash
cd C:\MIATA\miata_api
npm run dev
```

**Terminal 2 — Web**
```bash
cd C:\MIATA\miata_web
npm run dev
```

Open **http://localhost:5173**

**Seeded logins** (after `npm run db:seed`): `admin@miata.local`, `ramesh.agent@miata.local`, `niveditha@miata.local`,
`arun.kumar@miata.local` … — password `Miata-6C75DR9` the first time, then each account must choose a new password.
That password is published here, so before the site goes public, sign in to (or deactivate) every seeded account.

## Migrate later

Run in `C:\MIATA\miata_api` after new migration files are added:

```bash
npm run migrate         # applies new migrations to miata_live_db
npm run db:script       # regenerates database/miata_live_db.sql (also after changing database/seed)
```

To start again from the seed data, delete `miata_live_db` in pgAdmin (this deletes all its data) and run step 2 again.

## Problems?

| Problem | Fix |
|---|---|
| Cannot connect to PostgreSQL | Check `DB_PASSWORD` in `.env` and that PostgreSQL is running |
| Database does not exist / schema out of date | Run step 2 again |
| Port 5173 is already in use | Stop the other app using port 5173 |
| Can't sign in | Start the API first, and create a login with `npm run create-admin` |
| `db:seed` says the database already has data | The seed only loads into a new database; your existing data is untouched |
