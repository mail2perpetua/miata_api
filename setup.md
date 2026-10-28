# MIATA — Setup

**You need:** Node.js 20.19+ and PostgreSQL 14+ (with pgAdmin 4), with PostgreSQL running.

| Database | Purpose |
|---|---|
| `miata_live_db` | Live data (starts empty) |
| `miata_mock_db` | Sample data for development and testing |

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

## 2. Create the databases

```bash
npm run db:setup        # creates miata_live_db
npm run create-admin    # creates the first admin login for the live site
npm run db:seed         # creates miata_mock_db and seeds it with sample data
```

## 3. Set up the web

```bash
cd C:\MIATA\miata_web
npm install
```

## 4. Run both (two terminals)

**Terminal 1 — API**
```bash
cd C:\MIATA\miata_api
npm run dev             # live data
npm run dev:mock        # or: sample data
```

**Terminal 2 — Web**
```bash
cd C:\MIATA\miata_web
npm run dev
```

Open **http://localhost:5173**

**Sample logins** (with `npm run dev:mock`): `admin@miata.local`, `ramesh.agent@miata.local`, `niveditha@miata.local`,
`arun.kumar@miata.local` — password `Miata-6C75DR9`

## Migrate later

Run in `C:\MIATA\miata_api` after new migration files are added:

```bash
npm run migrate              # live database
npm run migrate -- --mock    # mock database
npm run db:seed -- --reset   # wipe the mock database and seed it again
```

If a database was deleted, run step 2 again.

The seed data is in `miata_api/database/mock-data` (one JSON file per table, plus sample files in `uploads/`). It only
ever goes into `miata_mock_db`, never into the live database.

## Problems?

| Problem | Fix |
|---|---|
| Cannot connect to PostgreSQL | Check `DB_PASSWORD` in `.env` and that PostgreSQL is running |
| Database does not exist / schema out of date | Run step 2 again |
| Port 5173 is already in use | Stop the other app using port 5173 |
| Can't sign in | Start the API first; on live data, create a login with `npm run create-admin` |
