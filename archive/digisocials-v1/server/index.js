import 'dotenv/config'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createClient } from '@supabase/supabase-js'
import { postSchema } from './validation.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0'
const publicUrl = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
const supabaseOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : 'https://*.supabase.co'
const databaseReady = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
const supabase = databaseReady
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: { directives: { "img-src": ["'self'", 'data:', 'https:'], "connect-src": ["'self'", supabaseOrigin], "font-src": ["'self'", 'data:'], "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"] } } }))
app.use(express.json({ limit: '1mb' }))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))

function fail(message, status = 400) {
  const error = new Error(message)
  error.status = status
  throw error
}

function db() {
  if (!supabase) fail('The Supabase backend is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.', 503)
  return supabase
}

async function result(query) {
  const { data, error } = await query
  if (error) {
    console.error('Supabase operation failed:', error.code || error.message)
    fail('A database operation failed. Check the Supabase schema and server logs.', 500)
  }
  return data
}

function encryptionKey() {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || '', 'base64')
  if (key.length !== 32) fail('Social connection storage is not configured. Set TOKEN_ENCRYPTION_KEY to a base64-encoded 32-byte key.', 503)
  return key
}

function encrypt(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`
}

function decrypt(value) {
  const [iv, tag, encrypted] = (value || '').split('.')
  if (!iv || !tag || !encrypted) fail('Stored connection token is invalid. Reconnect the social account.', 500)
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    fail('Stored connection token could not be decrypted. Reconnect the social account.', 500)
  }
}

function providerIsConfigured(provider) {
  const shared = Boolean(process.env.PUBLIC_APP_URL && /^https?:\/\/[^/]+$/i.test(publicUrl) && (process.env.NODE_ENV !== 'production' || publicUrl.startsWith('https://')) && process.env.TOKEN_ENCRYPTION_KEY && databaseReady)
  if (provider === 'meta') return shared && Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET)
  if (provider === 'linkedin') return shared && Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)
  return false
}

function callbackUrl() { return `${publicUrl}/api/oauth/callback` }
function oauthRedirect(query) { return `${publicUrl}/?${new URLSearchParams(query)}` }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function safeAccount(account) {
  return { id: account.id, provider: account.provider, platform: account.platform, platform_account_id: account.platform_account_id, display_name: account.display_name, username: account.username, connected_at: account.connected_at }
}

async function saveSocialAccount(account, accessToken, tokenExpiresAt) {
  const client = db()
  const { data, error } = await client.from('social_accounts')
    .upsert(account, { onConflict: 'workspace_id,platform,platform_account_id' })
    .select('id')
    .single()
  if (error) {
    console.error('Social account save failed:', error.code || error.message)
    fail('The platform authorized successfully, but saving the account failed. Check the server logs.', 500)
  }
  const { error: credentialError } = await client.from('social_account_credentials').upsert({
    account_id: data.id,
    owner_id: account.owner_id,
    workspace_id: account.workspace_id,
    access_token_encrypted: encrypt(accessToken),
    token_expires_at: tokenExpiresAt,
  }, { onConflict: 'account_id' })
  if (credentialError) {
    console.error('Social account credential save failed:', credentialError.code || credentialError.message)
    fail('The account was saved, but its encrypted provider credentials could not be stored. Try connecting again.', 500)
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', configured: databaseReady }))
app.get('/api/config', (_req, res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  providers: { meta: providerIsConfigured('meta'), linkedin: providerIsConfigured('linkedin') },
}))

app.get('/api/oauth/callback', async (req, res, next) => {
  try {
    const code = String(req.query.code || '')
    const state = String(req.query.state || '')
    if (req.query.error || !code || !state) return res.redirect(oauthRedirect({ oauth_error: 'The social platform cancelled or rejected the connection.' }))
    const stateRow = await result(db().from('provider_oauth_states').select('*').eq('state_hash', hash(state)).maybeSingle())
    if (!stateRow || new Date(stateRow.expires_at) <= new Date()) return res.redirect(oauthRedirect({ oauth_error: 'This connection request expired. Please try again.' }))
    await result(db().from('provider_oauth_states').delete().eq('id', stateRow.id))
    const provider = stateRow.provider
    if (!providerIsConfigured(provider)) return res.redirect(oauthRedirect({ oauth_error: 'The platform connection is not configured by an administrator.' }))

    if (provider === 'meta') {
      const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`)
      tokenUrl.search = new URLSearchParams({ client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: callbackUrl(), code }).toString()
      const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(15_000) })
      if (!tokenResponse.ok) return res.redirect(oauthRedirect({ oauth_error: 'Meta could not authorize this connection. Check the app configuration and try again.' }))
      const tokenData = await tokenResponse.json()
      if (typeof tokenData.access_token !== 'string') return res.redirect(oauthRedirect({ oauth_error: 'Meta returned an invalid authorization response.' }))
      const longTokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`)
      longTokenUrl.search = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: tokenData.access_token }).toString()
      const longTokenResponse = await fetch(longTokenUrl, { signal: AbortSignal.timeout(15_000) })
      if (!longTokenResponse.ok) return res.redirect(oauthRedirect({ oauth_error: 'Meta could not extend the access token. Check the app configuration and try again.' }))
      const longTokenData = await longTokenResponse.json()
      if (typeof longTokenData.access_token !== 'string') return res.redirect(oauthRedirect({ oauth_error: 'Meta returned an invalid long-lived token response.' }))
      const pagesResponse = await fetch(`https://graph.facebook.com/${graphVersion}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(longTokenData.access_token)}`, { signal: AbortSignal.timeout(15_000) })
      if (!pagesResponse.ok) return res.redirect(oauthRedirect({ oauth_error: 'Meta could not list your managed pages. Check permissions and page access.' }))
      const pagesData = await pagesResponse.json()
      const pages = Array.isArray(pagesData.data) ? pagesData.data : []
      if (!pages.length) return res.redirect(oauthRedirect({ oauth_error: 'No managed Facebook pages were found. Link or grant access to a Page, then try again.' }))
      const connections = []
      for (const page of pages) {
        if (!page.id || !page.access_token) continue
        connections.push({
          account: {
            owner_id: stateRow.owner_id, workspace_id: stateRow.workspace_id, provider: 'meta', platform: 'facebook',
            platform_account_id: String(page.id), display_name: String(page.name || 'Facebook Page').slice(0, 200), username: null,
          },
          accessToken: page.access_token,
        })
        if (page.instagram_business_account?.id) connections.push({
          account: {
            owner_id: stateRow.owner_id, workspace_id: stateRow.workspace_id, provider: 'meta', platform: 'instagram',
            platform_account_id: String(page.instagram_business_account.id),
            display_name: String(page.instagram_business_account.username || page.name || 'Instagram account').slice(0, 200),
            username: page.instagram_business_account.username ? String(page.instagram_business_account.username).slice(0, 200) : null,
          },
          accessToken: page.access_token,
        })
      }
      if (!connections.length) return res.redirect(oauthRedirect({ oauth_error: 'No publishable Meta Pages were found.' }))
      for (const connection of connections) await saveSocialAccount(connection.account, connection.accessToken, null)
      return res.redirect(oauthRedirect({ connected: 'meta' }))
    }

    if (provider === 'linkedin') {
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(), client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!tokenResponse.ok) return res.redirect(oauthRedirect({ oauth_error: 'LinkedIn could not authorize this connection. Check the app configuration and try again.' }))
      const tokenData = await tokenResponse.json()
      if (typeof tokenData.access_token !== 'string') return res.redirect(oauthRedirect({ oauth_error: 'LinkedIn returned an invalid authorization response.' }))
      const identityResponse = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` }, signal: AbortSignal.timeout(15_000) })
      if (!identityResponse.ok) return res.redirect(oauthRedirect({ oauth_error: 'LinkedIn could not retrieve your profile. Confirm the required scopes are enabled.' }))
      const identity = await identityResponse.json()
      if (typeof identity.sub !== 'string') return res.redirect(oauthRedirect({ oauth_error: 'LinkedIn returned an invalid profile.' }))
      await saveSocialAccount({
        owner_id: stateRow.owner_id, workspace_id: stateRow.workspace_id, provider: 'linkedin', platform: 'linkedin',
        platform_account_id: identity.sub, display_name: String(identity.name || 'LinkedIn member').slice(0, 200),
        username: null,
      }, tokenData.access_token, tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null)
      return res.redirect(oauthRedirect({ connected: 'linkedin' }))
    }
    return res.redirect(oauthRedirect({ oauth_error: 'This social platform is not supported.' }))
  } catch (error) { next(error) }
})

app.use('/api', async (req, res, next) => {
  try {
    const authorization = req.get('authorization') || ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'Sign in to access this workspace.' })
    const { data, error } = await db().auth.getUser(token)
    if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired. Sign in again.' })
    req.user = data.user
    next()
  } catch (error) { next(error) }
})

async function getWorkspace(user) {
  const client = db()
  let workspace = await result(client.from('workspaces').select('id,name,timezone,owner_id').eq('owner_id', user.id).maybeSingle())
  if (!workspace) {
    const name = typeof user.user_metadata?.display_name === 'string' ? `${user.user_metadata.display_name.slice(0, 80)}'s studio` : 'My studio'
    try {
      workspace = await result(client.from('workspaces').insert({ owner_id: user.id, name }).select('id,name,timezone,owner_id').single())
    } catch (error) {
      if (error.status !== 500) throw error
      workspace = await result(client.from('workspaces').select('id,name,timezone,owner_id').eq('owner_id', user.id).single())
    }
  }
  return workspace
}

async function getAnalytics(workspace) {
  const client = db()
  const [posts, accounts, snapshots] = await Promise.all([
    result(client.from('posts').select('status,published_at').eq('workspace_id', workspace.id)),
    result(client.from('social_accounts').select('id,display_name,platform').eq('workspace_id', workspace.id)),
    result(client.from('analytics_snapshots').select('account_id,external_post_id,metric_date,likes,comments,impressions').eq('workspace_id', workspace.id)),
  ])
  const totals = { published: 0, scheduled: 0, drafts: 0, failed: 0, accounts: accounts.length, likes: 0, comments: 0, impressions: 0 }
  for (const post of posts) {
    if (post.status === 'published' || (post.status === 'failed' && post.published_at)) totals.published += 1
    if (post.status === 'scheduled' || post.status === 'publishing') totals.scheduled += 1
    if (post.status === 'draft') totals.drafts += 1
    if (post.status === 'failed') totals.failed += 1
  }
  const latestSnapshots = new Map()
  for (const snapshot of snapshots) {
    const key = `${snapshot.account_id}:${snapshot.external_post_id}`
    const current = latestSnapshots.get(key)
    if (!current || snapshot.metric_date > current.metric_date) latestSnapshots.set(key, snapshot)
  }
  const byAccount = accounts.map((account) => {
    const rows = Array.from(latestSnapshots.values()).filter((snapshot) => snapshot.account_id === account.id)
    const metrics = rows.reduce((sum, row) => ({ likes: sum.likes + Number(row.likes || 0), comments: sum.comments + Number(row.comments || 0), impressions: sum.impressions + Number(row.impressions || 0) }), { likes: 0, comments: 0, impressions: 0 })
    totals.likes += metrics.likes; totals.comments += metrics.comments; totals.impressions += metrics.impressions
    return { account_id: account.id, name: account.display_name, platform: account.platform, ...metrics }
  })
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - 6)
  const recent = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + index)
    return { date: day.toISOString().slice(0, 10), published: posts.filter((post) => post.published_at && new Date(post.published_at).toISOString().slice(0, 10) === day.toISOString().slice(0, 10)).length }
  })
  return { totals, recent, byAccount }
}

app.get('/api/bootstrap', async (req, res) => {
  const workspace = await getWorkspace(req.user)
  const client = db()
  const [posts, accounts, analytics] = await Promise.all([
    result(client.from('posts').select('id,content,status,scheduled_at,account_ids,media_url,created_at,published_at,publish_results').eq('workspace_id', workspace.id).order('created_at', { ascending: false }).limit(200)),
    result(client.from('social_accounts').select('id,provider,platform,platform_account_id,display_name,username,connected_at').eq('workspace_id', workspace.id).order('connected_at', { ascending: true })),
    getAnalytics(workspace),
  ])
  res.json({ workspace: { id: workspace.id, name: workspace.name, timezone: workspace.timezone }, posts, accounts, analytics })
})

app.get('/api/posts', async (req, res) => {
  const workspace = await getWorkspace(req.user)
  const posts = await result(db().from('posts').select('id,content,status,scheduled_at,account_ids,media_url,created_at,published_at,publish_results').eq('workspace_id', workspace.id).order('created_at', { ascending: false }).limit(200))
  res.json({ posts })
})

app.post('/api/posts', async (req, res) => {
  const parsed = postSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the post details and try again.' })
  const post = parsed.data
  if (post.status === 'scheduled') {
    if (!post.scheduled_at || new Date(post.scheduled_at) <= new Date()) return res.status(400).json({ error: 'Choose a future date and time to schedule this post.' })
    if (!post.account_ids.length) return res.status(400).json({ error: 'Choose at least one connected account before scheduling.' })
  }
  const workspace = await getWorkspace(req.user)
  if (post.account_ids.length) {
    const matched = await result(db().from('social_accounts').select('id').eq('workspace_id', workspace.id).in('id', post.account_ids))
    if (matched.length !== new Set(post.account_ids).size) return res.status(403).json({ error: 'One or more selected social accounts are not available in this workspace.' })
  }
  const created = await result(db().from('posts').insert({
    workspace_id: workspace.id, owner_id: req.user.id, content: post.content, status: post.status,
    scheduled_at: post.status === 'scheduled' ? post.scheduled_at : null,
    account_ids: post.account_ids, media_url: post.media_url,
  }).select('id').single())
  res.status(201).json({ id: created.id })
})

app.delete('/api/posts/:id', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(400).json({ error: 'Post ID is invalid.' })
  const workspace = await getWorkspace(req.user)
  const deleted = await result(db().from('posts').delete().eq('id', req.params.id).eq('workspace_id', workspace.id).neq('status', 'publishing').select('id'))
  if (!deleted.length) {
    const post = await result(db().from('posts').select('status').eq('id', req.params.id).eq('workspace_id', workspace.id).maybeSingle())
    if (!post) return res.status(404).json({ error: 'Post not found in this workspace.' })
    return res.status(409).json({ error: 'This post is being published and cannot be deleted yet.' })
  }
  res.status(204).end()
})

app.get('/api/accounts', async (req, res) => {
  const workspace = await getWorkspace(req.user)
  const accounts = await result(db().from('social_accounts').select('id,provider,platform,platform_account_id,display_name,username,connected_at').eq('workspace_id', workspace.id))
  res.json({ accounts: accounts.map(safeAccount) })
})

app.delete('/api/accounts/:id', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(400).json({ error: 'Account ID is invalid.' })
  const workspace = await getWorkspace(req.user)
  const removed = await result(db().from('social_accounts').delete().eq('id', req.params.id).eq('workspace_id', workspace.id).select('id'))
  if (!removed.length) return res.status(404).json({ error: 'Account not found in this workspace.' })
  res.status(204).end()
})

app.post('/api/oauth/:provider/start', async (req, res) => {
  const provider = req.params.provider
  if (!['meta', 'linkedin'].includes(provider)) return res.status(404).json({ error: 'This social platform is not supported.' })
  if (!providerIsConfigured(provider)) return res.status(503).json({ error: 'This provider is not ready. Ask an administrator to configure the OAuth credentials and token encryption key.' })
  const workspace = await getWorkspace(req.user)
  await result(db().from('provider_oauth_states').delete().lt('expires_at', new Date().toISOString()).select('id'))
  const state = crypto.randomBytes(32).toString('base64url')
  await result(db().from('provider_oauth_states').insert({
    owner_id: req.user.id, workspace_id: workspace.id, provider, state_hash: hash(state),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }))
  const url = new URL(provider === 'meta' ? `https://www.facebook.com/${graphVersion}/dialog/oauth` : 'https://www.linkedin.com/oauth/v2/authorization')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', callbackUrl())
  url.searchParams.set('state', state)
  if (provider === 'meta') {
    url.searchParams.set('client_id', process.env.META_APP_ID)
    url.searchParams.set('scope', 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish')
  } else {
    url.searchParams.set('client_id', process.env.LINKEDIN_CLIENT_ID)
    url.searchParams.set('scope', 'openid profile w_member_social')
  }
  res.json({ authorizationUrl: url.toString() })
})

app.get('/api/analytics', async (req, res) => res.json(await getAnalytics(await getWorkspace(req.user))))

async function sendPlatformPost(post, account) {
  const token = decrypt(account.access_token_encrypted)
  if (account.platform === 'facebook') {
    const params = new URLSearchParams({ message: post.content, access_token: token })
    if (post.media_url) params.set('link', post.media_url)
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.platform_account_id)}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params, signal: AbortSignal.timeout(20_000) })
    if (!response.ok) fail(`Facebook returned HTTP ${response.status}. Check the Page permissions and post content.`)
    const body = await response.json()
    if (!body.id) fail('Facebook did not confirm that the post was published.')
    return String(body.id)
  }
  if (account.platform === 'instagram') {
    if (!post.media_url) fail('Instagram requires an image at a publicly accessible HTTPS URL.')
    if (!post.media_url.startsWith('https://')) fail('Instagram image URLs must use HTTPS.')
    const create = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.platform_account_id)}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ image_url: post.media_url, caption: post.content, access_token: token }), signal: AbortSignal.timeout(20_000),
    })
    if (!create.ok) fail(`Instagram returned HTTP ${create.status} while preparing the image. Check the URL and account permissions.`)
    const created = await create.json()
    if (!created.id) fail('Instagram did not confirm that the image was prepared.')
    const publish = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(account.platform_account_id)}/media_publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: String(created.id), access_token: token }), signal: AbortSignal.timeout(20_000),
    })
    if (!publish.ok) fail(`Instagram returned HTTP ${publish.status} while publishing. Check account permissions and media requirements.`)
    const published = await publish.json()
    if (!published.id) fail('Instagram did not confirm that the post was published.')
    return String(published.id)
  }
  if (account.platform === 'linkedin') {
    if (post.media_url) fail('LinkedIn image publishing is not supported yet. Remove the image or select a different channel.')
    if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) fail('The LinkedIn connection expired. Reconnect the account before publishing.')
    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0' },
      body: JSON.stringify({
        author: `urn:li:person:${account.platform_account_id}`, lifecycleState: 'PUBLISHED', visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: post.content }, shareMediaCategory: 'NONE' } },
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) fail(`LinkedIn returned HTTP ${response.status}. Check the app's Community Management API access and profile permissions.`)
    const id = response.headers.get('x-restli-id')
    if (!id) fail('LinkedIn did not confirm that the post was published.')
    return id
  }
  fail(`Publishing to ${account.platform} is not supported.`)
}

let schedulerBusy = false
async function publishDuePosts() {
  if (schedulerBusy || !supabase) return
  schedulerBusy = true
  try {
    await result(db().from('posts').update({
      status: 'failed',
      publish_results: [{ account: 'DigiSocials', ok: false, message: 'The publishing worker stopped while handling this post. Confirm its status on each social platform before creating a replacement.' }],
    }).eq('status', 'publishing').lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString()).select('id'))
    const due = await result(db().from('posts').select('id,workspace_id,owner_id,content,account_ids,media_url').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: true }).limit(10))
    for (const post of due) {
      const claimed = await result(db().from('posts').update({ status: 'publishing' }).eq('id', post.id).eq('status', 'scheduled').select('id'))
      if (!claimed.length) continue
      try {
        const accounts = await result(db().from('social_accounts').select('id,platform,platform_account_id,display_name').eq('workspace_id', post.workspace_id).in('id', post.account_ids || []))
        const credentials = await result(db().from('social_account_credentials').select('account_id,access_token_encrypted,token_expires_at').eq('workspace_id', post.workspace_id).in('account_id', post.account_ids || []))
        for (const account of accounts) {
          const credential = credentials.find((item) => item.account_id === account.id)
          if (credential) Object.assign(account, { access_token_encrypted: credential.access_token_encrypted, token_expires_at: credential.token_expires_at })
        }
        const results = []
        for (const accountId of post.account_ids || []) {
          const account = accounts.find((item) => item.id === accountId)
          if (!account || !account.access_token_encrypted) { results.push({ account: account?.display_name || 'Disconnected account', ok: false, message: 'The selected social account or its private credentials are no longer available.' }); continue }
          try {
            const externalId = await sendPlatformPost(post, account)
            results.push({ account: account.display_name, ok: true, external_id: externalId })
          } catch (error) {
            results.push({ account: account.display_name, ok: false, message: error instanceof Error ? error.message : 'The platform could not publish this post.' })
          }
        }
        const allSucceeded = results.length > 0 && results.every((item) => item.ok)
        const anySucceeded = results.some((item) => item.ok)
        const { error } = await db().from('posts').update({ status: allSucceeded ? 'published' : 'failed', published_at: anySucceeded ? new Date().toISOString() : null, publish_results: results }).eq('id', post.id).eq('workspace_id', post.workspace_id)
        if (error) throw error
      } catch (error) {
        console.error(`Scheduled post ${post.id} failed:`, error.code || error.message)
        await db().from('posts').update({ status: 'failed', publish_results: [{ account: 'DigiSocials', ok: false, message: 'The publishing worker encountered an internal error. Check server logs before retrying.' }] }).eq('id', post.id).eq('workspace_id', post.workspace_id)
      }
    }
  } catch (error) {
    console.error('Publishing scheduler failed:', error.code || error.message)
  } finally { schedulerBusy = false }
}

app.use(express.static(path.join(appRoot, 'dist'), { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }))
app.get('*path', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' })
  res.sendFile(path.join(appRoot, 'dist', 'index.html'), (error) => { if (error) next(error) })
})

app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500
  if (status >= 500) console.error('Request failed:', error.code || 'unhandled_error')
  res.status(status).json({ error: status >= 500 && status !== 503 ? 'The request could not be completed. Check the server logs and try again.' : error.message })
})

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`DigiSocials API listening on port ${port}; Supabase ${databaseReady ? 'configured' : 'not configured'}.`)
  if (!databaseReady) console.warn('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before using authenticated features.')
})
if (databaseReady) {
  const timer = setInterval(() => void publishDuePosts(), 30_000)
  timer.unref()
}

function shutdown() { server.close(() => process.exit(0)) }
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
