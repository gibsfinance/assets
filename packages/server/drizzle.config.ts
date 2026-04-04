import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://gibassets:password@localhost:5876/gibassets',
  },
  introspect: {
    casing: 'camel',
  },
})
