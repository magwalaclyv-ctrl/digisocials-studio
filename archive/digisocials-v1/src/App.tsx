import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import {
  ArrowRight, ArrowUpRight, BarChart3, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  FileText, Filter, Globe2, ImagePlus,
  LayoutDashboard, Link2, LoaderCircle, LogOut, Menu, MessageCircle,
  Plus, Search, Send, Settings2, Sparkles, WandSparkles, X,
} from 'lucide-react'

type View = 'overview' | 'calendar' | 'content' | 'analytics' | 'accounts'
type Provider = 'meta' | 'linkedin'
type Account = { id: string; provider: string; platform: string; platform_account_id: string; display_name: string; username: string | null; connected_at: string }
type Post = { id: string; content: string; status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed'; scheduled_at: string | null; account_ids: string[]; media_url: string | null; created_at: string; published_at: string | null; publish_results: { account: string; ok: boolean; message?: string }[] | null }
type Workspace = { id: string; name: string; timezone: string }
type AppConfig = { supabaseUrl: string; supabaseAnonKey: string; providers: { meta: boolean; linkedin: boolean } }
type Analytics = { totals: { published: number; scheduled: number; drafts: number; failed: number; accounts: number; likes: number; comments: number; impressions: number }; recent: { date: string; published: number }[]; byAccount: { account_id: string; name: string; platform: string; likes: number; comments: number; impressions: number }[] }

const platformMeta: Record<string, { label: string; className: string }> = {
  instagram: { label: 'Instagram', className: 'instagram' },
  facebook: { label: 'Facebook', className: 'facebook' },
  linkedin: { label: 'LinkedIn', className: 'linkedin' },
}

function localDateInput(minutesFromNow: number) {
  const date = new Date(Date.now() + minutesFromNow * 60_000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-emblem" role="img" aria-label="DigiTech Group logo mark" /><span className="brand-word">digi<span>socials</span></span></span>
}

function PlatformIcon({ platform, size = 16 }: { platform: string; size?: number }) {
  if (platform === 'instagram') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5.3" /><circle cx="12" cy="12" r="4" /><circle cx="17.8" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
  if (platform === 'facebook') return <span className="facebook-letter" style={{ fontSize: size }}>f</span>
  if (platform === 'linkedin') return <span className="linkedin-letter" style={{ fontSize: size - 2 }}>in</span>
  if (platform === 'youtube') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="4" fill="currentColor" /><path d="m10 9 5.5 3-5.5 3z" fill="white" /></svg>
  return <Globe2 size={size} />
}

function Avatar({ name, platform, large = false }: { name: string; platform?: string; large?: boolean }) {
  const initial = (name || 'D').trim().slice(0, 1).toUpperCase()
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-label={name}><span>{initial}</span>{platform && <i className={`platform-badge ${platform}`}><PlatformIcon platform={platform} size={10} /></i>}</span>
}

function App() {
  const [oauthCallback] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return { connected: params.get('connected'), error: params.get('oauth_error') }
  })
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [view, setView] = useState<View>(oauthCallback.connected ? 'accounts' : 'overview')
  const [posts, setPosts] = useState<Post[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(oauthCallback.error || '')
  const [notice, setNotice] = useState(oauthCallback.connected ? 'Your social account is connected.' : '')
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [searchText, setSearchText] = useState('')
  const [contentFilter, setContentFilter] = useState('all')
  const [calendarDate, setCalendarDate] = useState(() => new Date())
  const [today] = useState(() => new Date())

  useEffect(() => {
    let live = true
    const init = async () => {
      try {
        const response = await fetch('/api/config')
        if (!response.ok) throw new Error('Could not load application configuration.')
        const data: AppConfig = await response.json()
        if (!live) return
        setConfig(data)
        if (!data.supabaseUrl || !data.supabaseAnonKey) {
          setError('Supabase is not configured yet. Add the required environment variables to get started.')
          setLoading(false)
          return
        }
        const client = createClient(data.supabaseUrl, data.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
        setSupabase(client)
        const { data: { session: current }, error: sessionError } = await client.auth.getSession()
        if (sessionError) throw sessionError
        if (live) { setSession(current); setLoading(false) }
        const { data: listener } = client.auth.onAuthStateChange((_event, updated) => {
          if (live) setSession(updated)
        })
        return () => listener.subscription.unsubscribe()
      } catch (cause) {
        if (live) { setError(cause instanceof Error ? cause.message : 'Could not initialize DigiSocials.'); setLoading(false) }
      }
    }
    const unsubscribe = init()
    return () => { live = false; void unsubscribe.then((dispose) => dispose?.()) }
  }, [])

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.')
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...init.headers },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`)
    return payload as T
  }, [session])

  const refreshData = useCallback(async () => {
    if (!session) return
    setBusy(true)
    setError('')
    try {
      const data = await api<{ workspace: Workspace; posts: Post[]; accounts: Account[]; analytics: Analytics }>('/api/bootstrap')
      setWorkspace(data.workspace)
      setPosts(data.posts)
      setAccounts(data.accounts)
      setAnalytics(data.analytics)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load your workspace.')
    } finally { setBusy(false) }
  }, [api, session])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshData() }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshData])
  useEffect(() => {
    if (oauthCallback.connected || oauthCallback.error) window.history.replaceState({}, '', window.location.pathname)
  }, [oauthCallback])

  const doAuth = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setError('')
    try {
      if (authMode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { display_name: displayName } } })
        if (signUpError) throw signUpError
        if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.')
        else setNotice('Your workspace is ready.')
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
        if (signInError) throw signInError
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.') }
    finally { setBusy(false) }
  }

  const signOut = async () => {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
    else { setPosts([]); setAccounts([]); setAnalytics(null); setWorkspace(null); setNotice('You are signed out.') }
  }

  const savePost = async (payload: { content: string; account_ids: string[]; scheduled_at: string | null; media_url: string | null; status: 'draft' | 'scheduled' }) => {
    setError('')
    try {
      await api('/api/posts', { method: 'POST', body: JSON.stringify(payload) })
      setEditorOpen(false)
      setNotice(payload.status === 'scheduled' ? 'Post added to your publishing queue.' : 'Draft saved.')
      await refreshData()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your post.') }
  }

  const deletePost = async (post: Post) => {
    if (!window.confirm('Delete this post? This action cannot be undone.')) return
    setError('')
    try { await api(`/api/posts/${post.id}`, { method: 'DELETE' }); setSelectedPost(null); setNotice('Post deleted.'); await refreshData() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this post.') }
  }

  const connectProvider = async (provider: Provider) => {
    setError('')
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>(`/api/oauth/${provider}/start`, { method: 'POST' })
      window.location.assign(authorizationUrl)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start account connection.') }
  }

  const disconnectAccount = async (account: Account) => {
    if (!window.confirm(`Disconnect ${account.display_name}? Scheduled posts for this channel will not publish.`)) return
    setError('')
    try {
      await api(`/api/accounts/${account.id}`, { method: 'DELETE' })
      setNotice(`${account.display_name} disconnected.`)
      await refreshData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect this account.')
    }
  }

  const filteredPosts = useMemo(() => posts.filter((post) => {
    const matchesSearch = !searchText || post.content.toLowerCase().includes(searchText.toLowerCase())
    const matchesStatus = contentFilter === 'all' || post.status === contentFilter
    return matchesSearch && matchesStatus
  }), [posts, searchText, contentFilter])

  if (loading) return <div className="loading-screen"><Brand /><LoaderCircle className="spin" size={25} /><span>Getting your workspace ready</span></div>
  if (!session) return <AuthScreen
    config={config} authMode={authMode} setAuthMode={setAuthMode} authEmail={authEmail} setAuthEmail={setAuthEmail}
    authPassword={authPassword} setAuthPassword={setAuthPassword} displayName={displayName} setDisplayName={setDisplayName}
    error={error} notice={notice} busy={busy} onSubmit={doAuth}
  />

  const accountName = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'Creator'
  const pageTitle: Record<View, string> = { overview: 'Overview', calendar: 'Calendar', content: 'Content library', analytics: 'Analytics', accounts: 'Social accounts' }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Brand /><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-picker"><span className="workspace-glyph">{workspace?.name?.slice(0, 1) || 'D'}</span><span className="workspace-copy"><b>{workspace?.name || 'My workspace'}</b><small>Free plan</small></span><ChevronDown size={15} /></div>
      <span className="nav-label">WORKSPACE</span>
      <nav className="main-nav" aria-label="Main navigation">
        <NavItem active={view === 'overview'} icon={<LayoutDashboard size={17} />} label="Overview" onClick={() => { setView('overview'); setMobileNav(false) }} />
        <NavItem active={view === 'calendar'} icon={<CalendarDays size={17} />} label="Calendar" count={posts.filter((post) => post.status === 'scheduled').length} onClick={() => { setView('calendar'); setMobileNav(false) }} />
        <NavItem active={view === 'content'} icon={<FileText size={17} />} label="Content library" onClick={() => { setView('content'); setMobileNav(false) }} />
        <NavItem active={view === 'analytics'} icon={<BarChart3 size={17} />} label="Analytics" onClick={() => { setView('analytics'); setMobileNav(false) }} />
      </nav>
      <span className="nav-label accounts-label">PUBLISHING</span>
      <button className={`connected-nav ${view === 'accounts' ? 'active' : ''}`} onClick={() => { setView('accounts'); setMobileNav(false) }}><span className="connection-icon"><Link2 size={16} /></span><span>Social accounts</span><span className="connection-count">{accounts.length}</span></button>
      <div className="sidebar-account-stack">{accounts.slice(0, 3).map((account) => <div className="sidebar-account" key={account.id}><Avatar name={account.display_name} platform={account.platform} /><span>{account.display_name}</span><span className="online-dot" /></div>)}</div>
      <div className="sidebar-bottom">
        <div className="plan-card"><span className="plan-orbit"><Sparkles size={16} /></span><b>Your free studio</b><p>Make every post count. Start by connecting your first account.</p><button onClick={() => setView('accounts')}>Explore connections <ArrowRight size={13} /></button></div>
        <button className="profile-row" onClick={signOut}><Avatar name={accountName} /><span className="profile-name"><b>{accountName}</b><small>{session.user.email}</small></span><LogOut size={15} /></button>
      </div>
    </aside>
    {mobileNav && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="main-panel">
      <header className="topbar">
        <div className="topbar-heading"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><span className="crumb">Workspace</span><ChevronRight size={14} /><strong>{pageTitle[view]}</strong></div>
        <div className="topbar-actions"><span className="top-date">{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(today)}</span><span className="top-divider" /><button className="avatar-button" aria-label={`Sign out ${accountName}`} onClick={signOut}><Avatar name={accountName} /></button></div>
      </header>
      {(error || notice) && <div className={`toast ${error ? 'toast-error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <CircleHelp size={16} /> : <CheckCircle2 size={16} />}<span>{error || notice}</span><button onClick={() => { setError(''); setNotice('') }} aria-label="Dismiss"><X size={15} /></button></div>}
      {view === 'overview' && <Overview workspace={workspace} accounts={accounts} posts={posts} analytics={analytics} busy={busy} onCreate={() => setEditorOpen(true)} onConnect={() => setView('accounts')} onOpenPost={setSelectedPost} onNavigate={setView} />}
      {view === 'calendar' && <CalendarView posts={posts} accounts={accounts} date={calendarDate} setDate={setCalendarDate} onCreate={() => setEditorOpen(true)} onOpenPost={setSelectedPost} />}
      {view === 'content' && <ContentView posts={filteredPosts} search={searchText} setSearch={setSearchText} filter={contentFilter} setFilter={setContentFilter} onCreate={() => setEditorOpen(true)} onOpenPost={setSelectedPost} />}
      {view === 'analytics' && <AnalyticsView analytics={analytics} accounts={accounts} />}
      {view === 'accounts' && <AccountsView accounts={accounts} providers={config?.providers || { meta: false, linkedin: false }} onConnect={connectProvider} onDisconnect={disconnectAccount} busy={busy} />}
      <footer className="app-footer"><span>Made for the moments worth sharing.</span><span><span className="footer-dot" /> All systems operational</span></footer>
    </main>
    {editorOpen && <PostEditor accounts={accounts} onClose={() => setEditorOpen(false)} onSave={savePost} />}
    {selectedPost && <PostDetail post={selectedPost} accounts={accounts} onClose={() => setSelectedPost(null)} onDelete={() => void deletePost(selectedPost)} />}
  </div>
}

function AuthScreen(props: {
  config: AppConfig | null; authMode: 'signin' | 'signup'; setAuthMode: (mode: 'signin' | 'signup') => void
  authEmail: string; setAuthEmail: (value: string) => void; authPassword: string; setAuthPassword: (value: string) => void
  displayName: string; setDisplayName: (value: string) => void; error: string; notice: string; busy: boolean; onSubmit: (event: FormEvent) => void
}) {
  return <div className="auth-shell">
    <section className="auth-story"><div className="auth-brand"><Brand /></div><div className="story-content"><div className="story-label"><span /> YOUR SOCIAL STUDIO</div><h1>Good ideas<br />deserve <em>good<br className="story-break" /> timing.</em></h1><p>A calmer way to plan, create and share the work you're proud of.</p><div className="story-preview"><div className="preview-top"><div className="preview-avatar">D</div><span><b>Your next big idea</b><small>Ready when you are</small></span><span className="preview-status"><i /> ON THE CALENDAR</span></div><div className="preview-visual"><div className="visual-sun" /><div className="visual-hill hill-one" /><div className="visual-hill hill-two" /><span>make room<br />for <b>your next</b></span><span className="visual-tag">MONDAY · 9:30 AM</span></div><div className="preview-bottom"><span>Instagram · LinkedIn</span><span><Sparkles size={13} /> Made with intention</span></div></div></div><div className="story-foot"><span>Less juggling. More creating.</span><span>© 2026 DigiSocials</span></div></section>
    <section className="auth-panel"><div className="auth-form-wrap"><div className="mobile-auth-brand"><Brand /></div><div className="auth-eyebrow">{props.authMode === 'signin' ? 'WELCOME BACK' : 'A GOOD PLACE TO BEGIN'}</div><h2>{props.authMode === 'signin' ? 'Sign in to your studio' : 'Create your free account'}</h2><p className="auth-subtitle">{props.authMode === 'signin' ? 'Your content calendar is right where you left it.' : 'A shared home for all the things you want to say.'}</p>
      {props.notice && <div className="auth-alert success"><CheckCircle2 size={16} />{props.notice}</div>}
      {props.error && <div className="auth-alert"><CircleHelp size={16} />{props.error}</div>}
      {(!props.config?.supabaseUrl || !props.config?.supabaseAnonKey) && <div className="setup-note"><Settings2 size={16} /><span>First run? Add <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env</code> (or Fly secrets), then run the database migration. See <code>README.md</code>.</span></div>}
      <form className="auth-form" onSubmit={props.onSubmit}>
        {props.authMode === 'signup' && <label>Your name<input autoComplete="name" value={props.displayName} onChange={(event) => props.setDisplayName(event.target.value)} placeholder="Alex Morgan" required /></label>}
        <label>Email address<input type="email" autoComplete="email" value={props.authEmail} onChange={(event) => props.setAuthEmail(event.target.value)} placeholder="you@example.com" required /></label>
        <label>Password<span className="password-hint">At least 8 characters</span><input type="password" autoComplete={props.authMode === 'signin' ? 'current-password' : 'new-password'} minLength={8} value={props.authPassword} onChange={(event) => props.setAuthPassword(event.target.value)} placeholder="••••••••••" required /></label>
        <button className="button-primary auth-submit" disabled={props.busy || !props.config?.supabaseUrl || !props.config?.supabaseAnonKey}>{props.busy ? <LoaderCircle size={16} className="spin" /> : props.authMode === 'signin' ? 'Sign in' : 'Create account'}<ArrowRight size={16} /></button>
      </form>
      <p className="auth-switch">{props.authMode === 'signin' ? 'New to DigiSocials?' : 'Already have an account?'} <button onClick={() => props.setAuthMode(props.authMode === 'signin' ? 'signup' : 'signin')}>{props.authMode === 'signin' ? 'Create a free account' : 'Sign in'}</button></p>
      <div className="auth-fineprint">By continuing, you agree to use this workspace responsibly.<br />Your content stays yours. We just help you share it.</div></div></section>
  </div>
}

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'nav-active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count ? <small>{count}</small> : null}</button>
}

function SectionHead({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: string; action?: ReactNode }) {
  return <div className="section-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>
}

function Overview({ workspace, accounts, posts, analytics, busy, onCreate, onConnect, onOpenPost, onNavigate }: {
  workspace: Workspace | null; accounts: Account[]; posts: Post[]; analytics: Analytics | null; busy: boolean
  onCreate: () => void; onConnect: () => void; onOpenPost: (post: Post) => void; onNavigate: (view: View) => void
}) {
  const scheduled = posts.filter((post) => post.status === 'scheduled').sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))
  const firstName = workspace?.name || 'your studio'
  return <div className="page-content">
    <SectionHead eyebrow="YOUR SOCIAL STUDIO" title={<>A little more <em>in sync.</em></>} description={`Welcome to ${firstName}. Here’s what's happening across your channels.`} action={<button className="button-primary" onClick={onCreate}><Plus size={17} /> Create a post</button>} />
    <div className="welcome-strip"><div className="welcome-icon"><Sparkles size={20} /></div><div><b>Every good story starts somewhere.</b><p>{accounts.length ? 'Your studio is set up. Pick an idea and give it a place on the calendar.' : 'Connect a social account and bring your first idea into the studio.'}</p></div><button className="text-link" onClick={accounts.length ? onCreate : onConnect}>{accounts.length ? 'Write a post' : 'Connect your first account'} <ArrowRight size={14} /></button></div>
    <div className="stat-grid">
      <StatCard label="Posts published" value={analytics?.totals.published || 0} foot="All-time" icon={<Send size={17} />} color="coral" />
      <StatCard label="In the queue" value={analytics?.totals.scheduled || 0} foot="Ready for their moment" icon={<Clock3 size={17} />} color="violet" />
      <StatCard label="Drafts in progress" value={analytics?.totals.drafts || 0} foot="Ideas still taking shape" icon={<FileText size={17} />} color="blue" />
      <StatCard label="Connected channels" value={analytics?.totals.accounts || 0} foot={accounts.length ? 'Linked to your workspace' : 'Connect to get started'} icon={<Link2 size={17} />} color="green" />
    </div>
    <div className="dashboard-grid">
      <section className="panel next-up-panel"><div className="panel-head"><div><span className="eyebrow">COMING UP</span><h2>On the calendar</h2></div><button className="quiet-link" onClick={() => onNavigate('calendar')}>Full calendar <ArrowRight size={14} /></button></div>
        {busy ? <div className="panel-empty"><LoaderCircle className="spin" size={20} /> Loading your schedule</div> : scheduled.length ? <div className="upcoming-list">{scheduled.slice(0, 4).map((post) => <button className="upcoming-item" key={post.id} onClick={() => onOpenPost(post)}><span className="upcoming-date"><b>{post.scheduled_at ? new Date(post.scheduled_at).toLocaleDateString(undefined, { day: '2-digit' }) : '–'}</b><small>{post.scheduled_at ? new Date(post.scheduled_at).toLocaleDateString(undefined, { month: 'short' }) : ''}</small></span><span className="upcoming-copy"><span>{post.content || 'Untitled post'}</span><small>{post.scheduled_at ? new Date(post.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'Scheduled'}</small></span><span className="upcoming-platforms">{post.account_ids.slice(0, 3).map((id) => { const account = accounts.find((item) => item.id === id); return account ? <span key={id} className={`platform-mini ${account.platform}`}><PlatformIcon platform={account.platform} size={12} /></span> : null })}</span><ChevronRight size={15} /></button>)}</div> : <EmptyPanel icon={<CalendarDays size={20} />} title="A little breathing room" description={accounts.length ? 'You don’t have anything scheduled just yet. Give your next idea a date.' : 'Connect a social channel to start planning your next post.'} action={<button className="button-soft" onClick={accounts.length ? onCreate : onConnect}>{accounts.length ? <><Plus size={14} /> Plan a post</> : <><Link2 size={14} /> Connect an account</>}</button>} />}
      </section>
      <section className="panel channels-panel"><div className="panel-head"><div><span className="eyebrow">YOUR CHANNELS</span><h2>Across the socials</h2></div><button className="icon-button" onClick={onConnect} aria-label="Connect social account"><Plus size={17} /></button></div>
        {accounts.length ? <div className="channel-list">{accounts.slice(0, 4).map((account) => <div className="channel-item" key={account.id}><Avatar name={account.display_name} platform={account.platform} /><span className="channel-copy"><b>{account.display_name}</b><small>{platformMeta[account.platform]?.label || account.platform}</small></span><span className="channel-connected"><i /> Connected</span></div>)}{accounts.length > 4 && <button className="quiet-link see-all" onClick={onConnect}>See all {accounts.length} accounts <ArrowRight size={13} /></button>}</div> : <EmptyPanel icon={<Globe2 size={20} />} title="Your channels, together" description="Connect Instagram, Facebook or LinkedIn and plan in one place." action={<button className="button-soft" onClick={onConnect}><Plus size={14} /> Connect channels</button>} />}
      </section>
    </div>
    <section className="panel momentum-panel"><div className="momentum-copy"><span className="eyebrow">A MOMENT TO REFLECT</span><h2>Your creative rhythm</h2><p>Published activity appears here. Automatic platform engagement syncing isn’t included yet.</p><button className="quiet-link" onClick={() => onNavigate('analytics')}>Visit analytics <ArrowRight size={14} /></button></div><div className="momentum-visual"><div className="chart-axis"><span>4</span><span>3</span><span>2</span><span>1</span><span>0</span></div><div className="chart-bars">{(analytics?.recent || []).slice(-7).map((day) => <span className="chart-bar-wrap" key={day.date}><i style={{ height: `${Math.max(day.published * 36, day.published ? 20 : 3)}px` }} /><small>{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</small></span>)}</div><div className="chart-placeholder-note">{analytics?.totals.published ? `${analytics.totals.published} posts published` : 'Your first post is the start of something.'}</div></div></section>
    {posts.some((post) => post.status === 'failed') && <div className="failure-callout"><CircleHelp size={17} /><span><b>A post needs a second look.</b> One or more scheduled posts couldn’t be published. Open Content library to review the error.</span><button onClick={() => onNavigate('content')}>Review posts <ArrowRight size={14} /></button></div>}
  </div>
}

function StatCard({ label, value, foot, icon, color }: { label: string; value: number; foot: string; icon: ReactNode; color: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${color}`}>{icon}</span></div><strong>{value.toLocaleString()}</strong><div className="stat-foot">{foot}</div></div>
}

function EmptyPanel({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action: ReactNode }) {
  return <div className="empty-panel"><span className="empty-icon">{icon}</span><b>{title}</b><p>{description}</p>{action}</div>
}

function CalendarView({ posts, accounts, date, setDate, onCreate, onOpenPost }: { posts: Post[]; accounts: Account[]; date: Date; setDate: (date: Date) => void; onCreate: () => void; onOpenPost: (post: Post) => void }) {
  const [today] = useState(() => new Date())
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const firstDay = (monthStart.getDay() + 6) % 7
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((firstDay + days) / 7) * 7 }, (_, index) => index - firstDay + 1)
  const dayPosts = (day: number) => posts.filter((post) => post.scheduled_at && new Date(post.scheduled_at).getFullYear() === date.getFullYear() && new Date(post.scheduled_at).getMonth() === date.getMonth() && new Date(post.scheduled_at).getDate() === day)
  return <div className="page-content"><SectionHead eyebrow="PLAN AHEAD" title="Your calendar" description="A clear view of what's going out and when." action={<button className="button-primary" onClick={onCreate}><Plus size={17} /> Schedule a post</button>} />
    <section className="panel calendar-panel"><div className="calendar-toolbar"><div><button className="month-arrow" onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={19} /></button><button className="month-arrow" onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={19} /></button><h2>{date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2></div><button className="button-outline" onClick={() => setDate(new Date())}>Today</button></div><div className="calendar-grid">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}{cells.map((day, index) => {
      const valid = day > 0 && day <= days
      const currentPosts = valid ? dayPosts(day) : []
      const isToday = valid && date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && day === today.getDate()
      return <div className={`calendar-cell ${!valid ? 'calendar-outside' : ''} ${isToday ? 'calendar-today' : ''}`} key={index}><span className="calendar-day">{valid ? day : day <= 0 ? new Date(date.getFullYear(), date.getMonth(), day).getDate() : day - days}</span>{currentPosts.slice(0, 2).map((post) => <button className={`calendar-post ${post.status}`} key={post.id} onClick={() => onOpenPost(post)}><span>{post.content || 'Untitled post'}</span><small>{post.scheduled_at && new Date(post.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {post.account_ids.map((id) => accounts.find((item) => item.id === id)?.platform).filter(Boolean).join(', ')}</small></button>)}{currentPosts.length > 2 && <span className="calendar-more">+{currentPosts.length - 2} more</span>}</div>
    })}</div><div className="calendar-legend"><span><i className="legend-scheduled" /> Scheduled</span><span><i className="legend-published" /> Published</span><span><i className="legend-failed" /> Needs attention</span></div></section>
  </div>
}

function ContentView({ posts, search, setSearch, filter, setFilter, onCreate, onOpenPost }: { posts: Post[]; search: string; setSearch: (value: string) => void; filter: string; setFilter: (value: string) => void; onCreate: () => void; onOpenPost: (post: Post) => void }) {
  return <div className="page-content"><SectionHead eyebrow="EVERY IDEA, IN ONE PLACE" title="Content library" description="Drafts, scheduled posts and published work. All yours." action={<button className="button-primary" onClick={onCreate}><Plus size={17} /> Create a post</button>} />
    <div className="library-toolbar"><div className="search-wrap"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a post..." aria-label="Search posts" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</div><div className="filter-wrap"><Filter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter posts by status"><option value="all">All posts</option><option value="draft">Drafts</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="failed">Needs attention</option></select><ChevronDown size={14} /></div><span className="result-count">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</span></div>
    {posts.length ? <div className="content-grid">{posts.map((post) => <button className="content-card" key={post.id} onClick={() => onOpenPost(post)}><div className={`content-art ${post.media_url ? 'has-image' : ''}`} style={post.media_url ? { backgroundImage: `url("${post.media_url}")` } : undefined}><span className="content-art-brand"><span className="brand-mark"><span /><span /><span /><span /></span> DIGISOCIALS</span>{!post.media_url && <><span className="art-sun" /><span className="art-land art-land-one" /><span className="art-land art-land-two" /><span className="art-quote">{post.content ? post.content.slice(0, 82) : 'Make space for something good.'}</span></>}<span className={`status-pill ${post.status}`}>{post.status === 'failed' ? 'Needs attention' : post.status}</span></div><div className="content-card-body"><span className="content-card-text">{post.content || 'Untitled post'}</span><div className="content-card-meta"><span>{post.scheduled_at ? new Date(post.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : new Date(post.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span>{post.account_ids.length} {post.account_ids.length === 1 ? 'channel' : 'channels'}</span></div></div></button>)}</div> : <div className="panel library-empty"><span className="empty-icon"><FileText size={20} /></span><h3>{search || filter !== 'all' ? 'No posts match this view' : 'A fresh page'}</h3><p>{search || filter !== 'all' ? 'Try another search or clear the filters.' : 'Your drafts, scheduled posts and shared work will live here.'}</p><button className="button-soft" onClick={search || filter !== 'all' ? () => { setSearch(''); setFilter('all') } : onCreate}>{search || filter !== 'all' ? 'Clear filters' : <><Plus size={14} /> Start a new post</>}</button></div>}
  </div>
}

function AnalyticsView({ analytics, accounts }: { analytics: Analytics | null; accounts: Account[] }) {
  const totals = analytics?.totals
  return <div className="page-content"><SectionHead eyebrow="THE SIGNAL IN YOUR STORY" title="Analytics" description="Real results from your connected social accounts. No made-up numbers." action={<span className="live-data-badge"><i /> Live workspace data</span>} />
    <div className="stat-grid analytics-stats"><StatCard label="Published posts" value={totals?.published || 0} foot="All time" icon={<Send size={17} />} color="coral" /><StatCard label="Impressions" value={totals?.impressions || 0} foot={totals?.impressions ? 'Reported by connected channels' : 'Insights sync not configured'} icon={<ArrowUpRight size={17} />} color="violet" /><StatCard label="Likes" value={totals?.likes || 0} foot={totals?.likes ? 'Reported engagement' : 'Insights sync not configured'} icon={<Check size={17} />} color="blue" /><StatCard label="Comments" value={totals?.comments || 0} foot={totals?.comments ? 'Reported engagement' : 'Insights sync not configured'} icon={<MessageCircle size={17} />} color="green" /></div>
    <div className="dashboard-grid analytics-grid"><section className="panel analytics-chart"><div className="panel-head"><div><span className="eyebrow">PUBLISHING ACTIVITY</span><h2>Posts shared, by day</h2></div><span className="quiet-badge">Past 7 days</span></div><div className="activity-chart">{(analytics?.recent || []).map((day) => <div className="activity-day" key={day.date}><span className="activity-value">{day.published || ''}</span><div className="activity-track"><i style={{ height: `${day.published ? Math.min(day.published * 32, 100) : 2}%` }} /></div><small>{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small></div>)}</div>{!totals?.published && <p className="chart-empty-note">Once a post is actually published, you’ll see the activity here.</p>}</section><section className="panel engagement-panel"><div className="panel-head"><div><span className="eyebrow">CHANNEL BREAKDOWN</span><h2>Engagement</h2></div><span className="quiet-badge">From platform data</span></div>{accounts.length ? <div className="engagement-list">{accounts.map((account) => { const result = analytics?.byAccount.find((item) => item.account_id === account.id); return <div className="engagement-row" key={account.id}><Avatar name={account.display_name} platform={account.platform} /><span className="channel-copy"><b>{account.display_name}</b><small>{platformMeta[account.platform]?.label || account.platform}</small></span><span className="engagement-count"><b>{result?.likes ?? '—'}</b><small>likes</small></span><span className="engagement-count"><b>{result?.comments ?? '—'}</b><small>comments</small></span></div>})}</div> : <EmptyPanel icon={<BarChart3 size={20} />} title="Insights, when you’re ready" description="Connect a channel to get started. Analytics will appear here when a platform reports them." action={<span className="muted-small">Only verified platform metrics are shown.</span>} />}</section></div>
    <div className="analytics-note"><CircleHelp size={16} /><p><b>About your numbers.</b> Published counts come from DigiSocials. Likes, comments and impressions only appear when supported platform insights are available and have been synced. We never estimate or invent engagement data.</p></div>
  </div>
}

function AccountsView({ accounts, providers, onConnect, onDisconnect, busy }: { accounts: Account[]; providers: { meta: boolean; linkedin: boolean }; onConnect: (provider: Provider) => void; onDisconnect: (account: Account) => void; busy: boolean }) {
  return <div className="page-content"><SectionHead eyebrow="ONE PLACE FOR YOUR PRESENCE" title="Social accounts" description="Connect channels to plan and publish from your studio." />
    <div className="connection-intro"><div><span className="connect-orbit"><Link2 size={20} /></span><h2>Your channels, on your terms.</h2><p>DigiSocials uses the official platform authorization flow. Your account passwords are never shared with us.</p></div><div className="intro-lock"><span><Check size={18} /></span><b>Secure by design</b><small>Tokens are encrypted and only used to publish your approved posts.</small></div></div>
    {accounts.length > 0 && <section className="panel connected-panel"><div className="panel-head"><div><span className="eyebrow">CONNECTED</span><h2>Your channels</h2></div><span className="connected-count">{accounts.length} connected</span></div><div className="connected-grid">{accounts.map((account) => <div className="connected-card" key={account.id}><Avatar name={account.display_name} platform={account.platform} large /><div className="channel-copy"><b>{account.display_name}</b><small>{platformMeta[account.platform]?.label || account.platform}{account.username ? ` · @${account.username}` : ''}</small></div><span className="channel-connected"><i /> Connected</span><button className="button-outline disconnect-button" onClick={() => onDisconnect(account)} disabled={busy}>Disconnect</button></div>)}</div></section>}
    <div className="provider-heading"><div><span className="eyebrow">AVAILABLE CONNECTIONS</span><h2>Choose a channel to connect</h2></div><span className="provider-info"><CheckCircle2 size={14} /> Official sign-in, no passwords stored</span></div>
    <div className="provider-grid">
      <ProviderCard platform="instagram" name="Instagram & Facebook" detail="Connect Meta pages and any linked Instagram professional accounts." connected={accounts.filter((account) => account.provider === 'meta').length} configured={providers.meta} disabled={busy} onClick={() => onConnect('meta')} />
      <ProviderCard platform="linkedin" name="LinkedIn" detail="Share text posts to your personal LinkedIn profile." connected={accounts.filter((account) => account.platform === 'linkedin').length} configured={providers.linkedin} disabled={busy} onClick={() => onConnect('linkedin')} />
      <div className="provider-card provider-soon"><span className="provider-logo youtube"><PlatformIcon platform="youtube" size={20} /></span><div className="provider-card-copy"><b>YouTube</b><p>Video publishing isn't available in this release.</p><span className="provider-soon-tag">NOT AVAILABLE YET</span></div><button className="button-outline" disabled>Coming later</button></div>
    </div>
    <div className="api-notice"><div className="notice-mark"><Settings2 size={17} /></div><p><b>Provider setup is required.</b> Connections become active after an administrator configures the relevant OAuth app credentials and redirect URLs. See <code>README.md</code> for the exact setup. A successful connection does not guarantee access to every publishing feature—platform approvals and account types still apply.</p></div>
  </div>
}

function ProviderCard({ platform, name, detail, connected, configured, disabled, onClick }: { platform: string; name: string; detail: string; connected: number; configured: boolean; disabled: boolean; onClick: () => void }) {
  return <div className="provider-card"><span className={`provider-logo ${platform}`}><PlatformIcon platform={platform} size={20} /></span><div className="provider-card-copy"><b>{name}</b><p>{detail}</p>{connected > 0 ? <span className="provider-connected">{connected} {connected === 1 ? 'account' : 'accounts'} connected</span> : configured ? <span className="provider-ready"><i /> READY TO CONNECT</span> : <span className="provider-needs-setup"><Settings2 size={12} /> ADMIN SETUP NEEDED</span>}</div><button className={configured ? 'button-outline' : 'button-disabled'} disabled={!configured || disabled} onClick={onClick}>{disabled ? <LoaderCircle className="spin" size={14} /> : configured ? <><Plus size={14} /> Connect</> : 'Not configured'}</button></div>
}

function PostEditor({ accounts, onClose, onSave }: { accounts: Account[]; onClose: () => void; onSave: (payload: { content: string; account_ids: string[]; scheduled_at: string | null; media_url: string | null; status: 'draft' | 'scheduled' }) => Promise<void> }) {
  const [minimumSchedule] = useState(() => localDateInput(1))
  const [content, setContent] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [schedule, setSchedule] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const toggleAccount = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const submit = async (status: 'draft' | 'scheduled') => {
    setLocalError('')
    if (!content.trim()) { setLocalError('Add a little copy before saving your post.'); return }
    if (status === 'scheduled' && selected.length === 0) { setLocalError('Choose at least one connected channel.'); return }
    if (status === 'scheduled' && !scheduledAt) { setLocalError('Choose a date and time for this post.'); return }
    if (status === 'scheduled' && new Date(scheduledAt) <= new Date()) { setLocalError('Choose a time in the future.'); return }
    setSaving(true)
    await onSave({ content: content.trim(), account_ids: selected, scheduled_at: status === 'scheduled' ? new Date(scheduledAt).toISOString() : null, media_url: mediaUrl.trim() || null, status })
    setSaving(false)
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="modal-head"><div><span className="eyebrow">MAKE SOMETHING GOOD</span><h2 id="editor-title">Create a post</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><div className="editor-body"><label className="editor-label">Your post<textarea value={content} maxLength={3000} onChange={(event) => setContent(event.target.value)} placeholder="Start with the thing you want people to remember..." rows={5} autoFocus /></label><div className="editor-meta"><span><WandSparkles size={14} /> Be yourself. That’s the whole idea.</span><span>{content.length} / 3,000</span></div><label className="editor-label media-input-label"><span>Image URL <small>Optional · required for Instagram publishing</small></span><input type="url" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://your-public-image-url.jpg" /><ImagePlus size={16} /></label><div className="editor-label">Publish to <small>Select one or more connected channels</small></div>{accounts.length ? <div className="editor-accounts">{accounts.map((account) => <button key={account.id} className={`editor-account ${selected.includes(account.id) ? 'selected' : ''}`} onClick={() => toggleAccount(account.id)}><Avatar name={account.display_name} platform={account.platform} /><span><b>{account.display_name}</b><small>{platformMeta[account.platform]?.label || account.platform}</small></span><span className="select-check">{selected.includes(account.id) && <Check size={13} />}</span></button>)}</div> : <div className="editor-no-accounts"><Link2 size={16} /> Save this post as a draft, or connect a channel to schedule it.</div>}{schedule && <label className="editor-label schedule-label">Date and time<input type="datetime-local" value={scheduledAt} min={minimumSchedule} onChange={(event) => setScheduledAt(event.target.value)} /></label>}{localError && <p className="inline-error" role="alert">{localError}</p>}</div><div className="modal-foot"><button className="button-outline" disabled={saving} onClick={() => void submit('draft')}>{saving ? <LoaderCircle className="spin" size={14} /> : <FileText size={14} />} Save draft</button>{schedule ? <button className="button-primary" disabled={saving || !accounts.length} onClick={() => void submit('scheduled')}>{saving ? <LoaderCircle className="spin" size={14} /> : <CalendarDays size={14} />} Schedule post</button> : <button className="button-primary" disabled={saving || !accounts.length} onClick={() => setSchedule(true)}><Clock3 size={14} /> Pick a time</button>}</div></div></div>
}

function PostDetail({ post, accounts, onClose, onDelete }: { post: Post; accounts: Account[]; onClose: () => void; onDelete: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="modal-head"><div><span className={`status-pill ${post.status}`}>{post.status === 'failed' ? 'Needs attention' : post.status}</span><h2 id="detail-title">Post details</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><div className="detail-content">{post.media_url && <img className="detail-image" src={post.media_url} alt="Post creative" />}<p>{post.content || 'Untitled post'}</p><div className="detail-meta"><span><Clock3 size={15} />{post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : post.published_at ? `Published ${new Date(post.published_at).toLocaleString()}` : `Created ${new Date(post.created_at).toLocaleString()}`}</span><span><Globe2 size={15} />{post.account_ids.map((id) => accounts.find((item) => item.id === id)?.display_name || 'Disconnected account').join(', ') || 'No channels selected'}</span></div>{post.status === 'failed' && <div className="publish-results"><b>Publishing result</b>{post.publish_results?.map((result, index) => <p key={index}><span className={result.ok ? 'result-ok' : 'result-failed'}>{result.ok ? 'Published' : 'Not published'}</span> · {result.account}{result.message ? ` — ${result.message}` : ''}</p>)}</div>}</div><div className="modal-foot"><button className="button-danger" onClick={onDelete}><X size={15} /> Delete post</button><button className="button-outline" onClick={onClose}>Close</button></div></div></div>
}

export default App
