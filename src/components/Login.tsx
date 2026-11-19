import { useState } from 'react'
import { ArrowRight, KeyRound, X } from 'lucide-react'
import { login } from '../api'
import type { Account } from '../types'
export function Login({ onLogin, onClose }: { onLogin: (account: Account) => void; onClose?: () => void }) {
  const [useKey, setUseKey] = useState(false), [url, setUrl] = useState(''), [email, setEmail] = useState(''), [secret, setSecret] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <div className="login-screen"><section className="login-story"><div className="wordmark"><img src="/logo.svg" alt=""/>zoomerlip<span>FOR ZULIP</span></div><div className="story-copy"><div className="eyebrow">SAME CONVERSATIONS. NEW ENERGY.</div><h1>Your people.<br/>Your channels.<br/><span>Your kind of place.</span></h1><p>All the good parts of Zulip, in a place that feels like home. Drop into a channel. Follow a thread. Stay in the loop.</p><div className="story-tags"><span># your-community</span><span>↳ the next big thing</span></div></div><footer>Built for conversation. Made to feel familiar.</footer></section><section className="login-side"><form className="login-card" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { onLogin(await login(url, email, secret, useKey)) } catch (e) { setError(e instanceof TypeError ? 'Cannot reach this org. Check the URL, connection, and server CORS settings.' : (e as Error).message) } finally { setBusy(false) } }}>
    {onClose && <button type="button" className="close icon-button" aria-label="Close login" onClick={onClose}><X size={20}/></button>}
    <div className="login-symbol"><KeyRound size={24}/></div><h2>Come on in.</h2><p>Connect your Zulip organization.</p>
    <label>Organization URL<input autoFocus required placeholder="https://your-team.zulipchat.com" value={url} onChange={e => setUrl(e.target.value)} autoComplete="url"/></label>
    <label>Email address<input required type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username"/></label>
    <div className="login-tabs"><button type="button" className={!useKey ? 'active' : ''} onClick={() => {setUseKey(false);setSecret('')}}>Password</button><button type="button" className={useKey ? 'active' : ''} onClick={() => {setUseKey(true);setSecret('')}}>API key / SSO</button></div>
    <label>{useKey ? 'API key' : 'Password'}<input required type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete={useKey ? 'off' : 'current-password'} placeholder={useKey ? 'Paste your Zulip API key' : 'Your Zulip password'}/></label>
    {useKey && <small>Find your key in Zulip → Personal settings → Account & privacy → API key.</small>}
    {error && <div className="error" role="alert">{error}</div>}
    <button className="primary connect" disabled={busy}>{busy ? 'Connecting…' : 'Let’s go'}<ArrowRight size={18}/></button>
    <p className="privacy">Connects directly to your org. API keys stay in this browser’s local storage. Passwords are never saved.</p>
  </form><span className="independent">An independent Zulip client. A little more you.</span></section></div>
}
