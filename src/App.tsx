import './App.css'
import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { Button, TextInput } from './components/ui'
import SettingsPage from './pages/SettingsPage'
import CreatePage from './pages/CreatePage'
import LibraryPage from './pages/LibraryPage'
import UserManagePage from './pages/UserManagePage'
import BillingPage from './pages/BillingPage'

type SessionAccount = {
  id: string
  username: string
  displayName: string
  role: 'superadmin' | 'admin' | 'user'
  lastLoginAt: string
}

function formatLoginTime(value: string) {
  if (!value) return '刚刚登录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function AccessDenied() {
  return <div style={{ color: 'rgba(255, 130, 130, 0.95)' }}>无权限访问该页面。</div>
}

function LoginRequired() {
  return <div style={{ color: 'rgba(255, 255, 255, 0.9)' }}>请先登录后使用系统功能。</div>
}

function AuthModal(props: {
  type: 'login' | 'register'
  onClose: () => void
  onLoginSuccess: (account: SessionAccount) => void
  onRegisterSuccess: () => void
}) {
  const { type, onClose, onLoginSuccess, onRegisterSuccess } = props
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!username.trim() || !password.trim()) {
      setError('请输入账号和密码')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (type === 'login') {
        const res = await window.api.auth.login({
          username: username.trim(),
          password: password.trim(),
        })
        onLoginSuccess(res.account)
      } else {
        await window.api.auth.register({
          username: username.trim(),
          password: password.trim(),
          displayName: displayName.trim() || undefined,
        })
        onRegisterSuccess()
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-modal-mask" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-title">{type === 'login' ? '登录' : '注册'}</div>
        <div className="auth-modal-form">
          <TextInput value={username} onChange={setUsername} placeholder="账号（3-32位）" />
          {type === 'register' ? <TextInput value={displayName} onChange={setDisplayName} placeholder="昵称（可选）" /> : null}
          <TextInput value={password} onChange={setPassword} placeholder="密码（至少6位）" type="password" />
        </div>
        {error ? <div className="account-error">{error}</div> : null}
        <div className="auth-modal-actions">
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting} variant="primary">
            {type === 'login' ? '登录' : '注册'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SidebarAccount(props: {
  account: SessionAccount | null
  loading: boolean
  onChange: (next: SessionAccount | null) => void
}) {
  const { account, loading, onChange } = props
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState<'login' | 'register' | null>(null)

  async function handleLogout() {
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      await window.api.auth.logout()
      onChange(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="sidebar-foot">账户信息加载中...</div>

  return (
    <>
      <div className="sidebar-account">
        {account ? (
          <>
            <div className="account-header">
              <div className="account-avatar">{account.displayName.slice(0, 1).toUpperCase() || 'U'}</div>
              <div className="account-header-text">
                <div className="account-name">{account.displayName}</div>
                <div className="account-role">{account.role}</div>
              </div>
            </div>
            <div className="account-meta">
              <div className="account-row">
                <span>账号</span>
                <strong>{account.username}</strong>
              </div>
              <div className="account-row">
                <span>登录时间</span>
                <strong>{formatLoginTime(account.lastLoginAt)}</strong>
              </div>
            </div>
            {error ? <div className="account-error">{error}</div> : null}
            <Button onClick={() => void handleLogout()} disabled={submitting}>
              退出登录
            </Button>
          </>
        ) : (
          <>
            <div className="auth-actions">
              <Button onClick={() => setModal('register')} variant="default">
                注册
              </Button>
              <Button onClick={() => setModal('login')} variant="primary">
                登录
              </Button>
            </div>
            {error ? <div className="account-error">{error}</div> : null}
            {notice ? <div className="account-hint">{notice}</div> : null}
          </>
        )}
      </div>

      {modal ? (
        <AuthModal
          type={modal}
          onClose={() => setModal(null)}
          onLoginSuccess={(next) => {
            setError('')
            setNotice('')
            onChange(next)
          }}
          onRegisterSuccess={() => {
            setError('')
            setNotice('注册成功，请使用刚注册的账号登录')
          }}
        />
      ) : null}
    </>
  )
}

function App() {
  const [account, setAccount] = useState<SessionAccount | null>(null)
  const [loadingAccount, setLoadingAccount] = useState(true)

  useEffect(() => {
    let mounted = true
    void window.api.auth
      .getSession()
      .then((res) => {
        if (!mounted) return
        setAccount(res.account)
      })
      .finally(() => {
        if (!mounted) return
        setLoadingAccount(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">智能AI小说创作</div>
        {account ? (
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              创作中心
            </NavLink>
            <NavLink to="/library" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              作品库
            </NavLink>
            <NavLink to="/billing" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              余额充值
            </NavLink>
            {account.role === 'superadmin' ? (
              <>
                <NavLink to="/settings" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                  设置
                </NavLink>
                <NavLink to="/users" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                  用户管理
                </NavLink>
              </>
            ) : null}
          </nav>
        ) : null}
        <SidebarAccount account={account} loading={loadingAccount} onChange={setAccount} />
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={account ? <CreatePage /> : <LoginRequired />} />
          <Route path="/library" element={account ? <LibraryPage /> : <LoginRequired />} />
          <Route path="/billing" element={account ? <BillingPage /> : <LoginRequired />} />
          <Route path="/settings" element={account?.role === 'superadmin' ? <SettingsPage /> : account ? <AccessDenied /> : <LoginRequired />} />
          <Route path="/users" element={account?.role === 'superadmin' ? <UserManagePage /> : <AccessDenied />} />
          <Route path="*" element={account ? <CreatePage /> : <LoginRequired />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
