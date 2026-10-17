import test from 'node:test'
import assert from 'node:assert/strict'
import { postSchema } from './validation.js'

const validDraft = {
  content: 'A note worth sharing.',
  account_ids: [],
  status: 'draft',
  scheduled_at: null,
  media_url: null,
}

test('accepts a draft without a connected social account', () => {
  assert.equal(postSchema.safeParse(validDraft).success, true)
})

test('rejects blank and oversized post content', () => {
  assert.equal(postSchema.safeParse({ ...validDraft, content: '  ' }).success, false)
  assert.equal(postSchema.safeParse({ ...validDraft, content: 'x'.repeat(3001) }).success, false)
})

test('rejects malformed account IDs and unsupported post states', () => {
  assert.equal(postSchema.safeParse({ ...validDraft, account_ids: ['not-a-uuid'] }).success, false)
  assert.equal(postSchema.safeParse({ ...validDraft, status: 'published' }).success, false)
})

test('rejects duplicate target accounts', () => {
  const accountId = '6b6f9a19-0bd1-48f1-a96c-3c399d285bd3'
  assert.equal(postSchema.safeParse({ ...validDraft, account_ids: [accountId, accountId] }).success, false)
})

test('accepts public HTTPS media URLs but rejects non-web schemes', () => {
  assert.equal(postSchema.safeParse({ ...validDraft, media_url: 'https://cdn.example.com/post.jpg' }).success, true)
  assert.equal(postSchema.safeParse({ ...validDraft, media_url: 'file:///private/post.jpg' }).success, false)
})
