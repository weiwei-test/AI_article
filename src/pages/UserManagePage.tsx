import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Field, InlineCode, TextInput } from '../components/ui'

type UserRole = 'superadmin' | 'admin' | 'user'

type UserProfile = {
  id: string
  username: string
  displayName: string
  role: UserRole
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

const ROLE_OPTIONS: UserRole[] = ['superadmin', 'admin', 'user']

function UserModal(props: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={props.onClose}>
      <div
        style={{
          width: 'min(520px, calc(100vw - 32px))',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 14,
          background: '#111725',
          padding: 14,
          display: 'grid',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>{props.title}</div>
        {props.children}
      </div>
    </div>
  )
}

export default function UserManagePage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [viewUser, setViewUser] = useState<UserProfile | null>(null)
  const [editUser, setEditUser] = useState<UserProfile | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const [newUsername, setNewUsername] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('user')

  const [editRole, setEditRole] = useState<UserRole>('user')
  const [editPassword, setEditPassword] = useState('')

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [users])

  async function refreshUsers() {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.auth.users.list()
      setUsers(res.users)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshUsers()
  }, [])

  async function createUser() {
    if (!newUsername.trim() || !newPassword.trim()) {
      setError('请填写账号和密码')
      return
    }
    setWorking(true)
    setError('')
    setNotice('')
    try {
      await window.api.auth.users.create({
        username: newUsername.trim(),
        displayName: newDisplayName.trim() || undefined,
        password: newPassword.trim(),
        role: newRole,
      })
      setNotice('用户创建成功')
      setCreateOpen(false)
      setNewUsername('')
      setNewDisplayName('')
      setNewPassword('')
      setNewRole('user')
      await refreshUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function saveEdit() {
    if (!editUser) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      if (editRole !== editUser.role) {
        await window.api.auth.users.updateRole({ userId: editUser.id, role: editRole })
      }
      if (editPassword.trim()) {
        await window.api.auth.users.resetPassword({ userId: editUser.id, password: editPassword.trim() })
      }
      setNotice(`已更新用户 ${editUser.username}`)
      setEditUser(null)
      setEditPassword('')
      await refreshUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function removeUser(user: UserProfile) {
    const confirmed = window.confirm(`确认删除用户 ${user.username} 吗？`)
    if (!confirmed) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      await window.api.auth.users.delete({ userId: user.id })
      setNotice(`已删除用户 ${user.username}`)
      await refreshUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 980 }}>
      <h2 style={{ margin: 0 }}>用户管理（超管）</h2>

      {error ? (
        <div style={{ color: 'rgba(255, 120, 120, 0.92)' }}>
          错误：<InlineCode>{error}</InlineCode>
        </div>
      ) : null}
      {notice ? (
        <div style={{ color: 'rgba(165, 255, 195, 0.9)' }}>
          提示：<InlineCode>{notice}</InlineCode>
        </div>
      ) : null}

      <Card
        title="用户列表"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => void refreshUsers()} disabled={loading || working}>
              刷新
            </Button>
            <Button onClick={() => setCreateOpen(true)} variant="primary" disabled={working}>
              新增用户
            </Button>
          </div>
        }
      >
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.68)' }}>正在加载用户...</div>
        ) : (
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1.2fr) minmax(100px, 0.8fr) minmax(140px, 1fr) minmax(220px, 1fr)',
                gap: 8,
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.03)',
                fontSize: 12,
                color: 'rgba(255,255,255,0.72)',
              }}
            >
              <div>用户</div>
              <div>角色</div>
              <div>最近登录</div>
              <div style={{ textAlign: 'right' }}>操作</div>
            </div>
            {sortedUsers.map((user) => (
              <div
                key={user.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(180px, 1.2fr) minmax(100px, 0.8fr) minmax(140px, 1fr) minmax(220px, 1fr)',
                  gap: 8,
                  padding: '12px',
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 650 }}>{user.displayName || user.username}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.66)' }}>
                    账号：<InlineCode>{user.username}</InlineCode>
                  </div>
                </div>
                <div>{user.role}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '从未登录'}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button onClick={() => setViewUser(user)}>查看</Button>
                  <Button
                    onClick={() => {
                      setEditUser(user)
                      setEditRole(user.role)
                      setEditPassword('')
                    }}
                  >
                    编辑
                  </Button>
                  <Button onClick={() => void removeUser(user)} variant="danger" disabled={working}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {createOpen ? (
        <UserModal title="新增用户" onClose={() => setCreateOpen(false)}>
          <Field label="账号">
            <TextInput value={newUsername} onChange={setNewUsername} placeholder="例如：editor01" />
          </Field>
          <Field label="昵称">
            <TextInput value={newDisplayName} onChange={setNewDisplayName} placeholder="可选" />
          </Field>
          <Field label="密码">
            <TextInput value={newPassword} onChange={setNewPassword} type="password" placeholder="至少6位" />
          </Field>
          <Field label="角色">
            <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={() => void createUser()} variant="primary" disabled={working}>
              创建
            </Button>
          </div>
        </UserModal>
      ) : null}

      {editUser ? (
        <UserModal title={`编辑用户：${editUser.username}`} onClose={() => setEditUser(null)}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
            创建时间：{new Date(editUser.createdAt).toLocaleString()}
          </div>
          <Field label="角色">
            <select className="input" value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)}>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
          <Field label="重置密码（可选）">
            <TextInput value={editPassword} onChange={setEditPassword} type="password" placeholder="留空表示不修改" />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setEditUser(null)}>取消</Button>
            <Button onClick={() => void saveEdit()} variant="primary" disabled={working}>
              保存
            </Button>
          </div>
        </UserModal>
      ) : null}

      {viewUser ? (
        <UserModal title={`查看用户：${viewUser.username}`} onClose={() => setViewUser(null)}>
          <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
            <div>昵称：{viewUser.displayName || '-'}</div>
            <div>账号：{viewUser.username}</div>
            <div>角色：{viewUser.role}</div>
            <div>创建时间：{new Date(viewUser.createdAt).toLocaleString()}</div>
            <div>更新时间：{new Date(viewUser.updatedAt).toLocaleString()}</div>
            <div>最近登录：{viewUser.lastLoginAt ? new Date(viewUser.lastLoginAt).toLocaleString() : '从未登录'}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setViewUser(null)}>关闭</Button>
          </div>
        </UserModal>
      ) : null}
    </div>
  )
}

