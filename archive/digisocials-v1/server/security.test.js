import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/202610170001_initial_schema.sql', import.meta.url), 'utf8')

test('provider credentials are stored separately from user-readable account metadata', () => {
  const accountDefinition = migration.split('create table if not exists public.social_accounts (')[1]?.split(');')[0]
  assert.ok(accountDefinition)
  assert.doesNotMatch(accountDefinition, /access_token_encrypted|token_expires_at/)
  assert.match(migration, /create table if not exists public\.social_account_credentials/)
  assert.match(migration, /revoke all on public\.social_account_credentials from anon, authenticated/)
})

test('OAuth state is not accessible to browser roles', () => {
  assert.match(migration, /alter table public\.provider_oauth_states enable row level security/)
  assert.match(migration, /revoke all on public\.provider_oauth_states from anon, authenticated/)
})
