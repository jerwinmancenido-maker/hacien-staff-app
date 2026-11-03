# Go-Live Checklist

Follow this checklist for initial production deployment and go-live. The live application starts empty — fake business data must never land on the production database.

> [!IMPORTANT]
> The live app starts empty. Never set `SEED_DEMO_STAGING=1` on production.

## 1. Back up database
Before running any migration or seed command on live, create a full backup of the production database:
```bash
mysqldump -u <USER> -p <DB_NAME> > backup_before_golive.sql
```

## 2. Deploy schema migrations
Run database migrations using Prisma deploy:
```bash
npm run db:deploy
```
*(Executes `prisma migrate deploy`.)*

## 3. Run base seed
Run the base seed to initialize required system settings, withholding catalog, and the first Admin user:
```bash
npm run db:seed
```
- **Base seed only:** Creates version 1 of system settings defaults, BIR withholding catalog rates, and the initial Admin account (`jerwin@example.com`).
- **Never set `SEED_DEMO_STAGING=1` on live:** Demo business data (customers, quotes, sales orders, etc.) is strictly for staging.
- Set `SEED_PASSWORD` in the environment if you wish to define an initial password; otherwise, a random password is generated and the user can reset it via "Forgot password".

## 4. Log in and verify empty state
1. Log in as Admin (`jerwin@example.com` or configured admin email).
2. Check the **Home** dashboard:
   - Sales / pipeline shows **₱0.00**.
   - No customers exist.
   - No quotes exist.
   - No sales orders (SOs) exist.
   - No billings, collections, or purchase orders exist.
3. Check **Settings** to confirm company defaults are loaded.

## Staging Demo Data
Staging environments populate sample business records (TESDA, Sample Corp, demo quotes and orders) by providing the staging opt-in flag:
```bash
SEED_DEMO_STAGING=1 npm run db:seed
```
Running demo seeding without `SEED_DEMO_STAGING=1` refuses immediately and writes nothing.
