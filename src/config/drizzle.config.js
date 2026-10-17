import 'dotenv/config';

// drizzle-kit (generate/migrate/studio) talks over the raw Postgres wire
// protocol, not the HTTP driver, so unlike database.js it doesn't need the
// neonConfig overrides. It does need relaxed SSL in development, though:
// Neon Local terminates TLS with a self-signed certificate, which a plain
// `sslmode=require` connection would otherwise reject.
const isDev = process.env.NODE_ENV === 'development';

export default {
  schema: './src/models/*.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ...(isDev ? { ssl: { rejectUnauthorized: false } } : {}),
  },
};
