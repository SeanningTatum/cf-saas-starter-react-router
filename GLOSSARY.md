# Glossary

- `HealthRepository`: Effect service in `app/repositories/health.ts`; `pingDatabase()` runs `select 1` on D1 and reports `{ ok, latencyMs, error? }`, with a failure as data.
- `dbHealth`: admin-only tRPC query `admin.dbHealth`; returns `{ ok, latencyMs, checkedAt, error? }`.
