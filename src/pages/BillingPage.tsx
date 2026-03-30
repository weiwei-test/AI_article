import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Field, InlineCode, NumberInput } from '../components/ui'

type BillingRecord = {
  id: string
  userId: string
  type: 'recharge' | 'consume'
  amount: number
  balanceAfter: number
  title: string
  note?: string
  createdAt: string
}

export default function BillingPage() {
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [balance, setBalance] = useState(0)
  const [records, setRecords] = useState<BillingRecord[]>([])
  const [customRecharge, setCustomRecharge] = useState(100000)
  const [customConsume, setCustomConsume] = useState(50000)

  const rechargePresets = useMemo(() => [50000, 100000, 300000, 1000000], [])

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.billing.get()
      setBalance(res.balance)
      setRecords(res.records)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function recharge(amount: number) {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const next = await window.api.billing.recharge({
        amount: Number(amount),
        title: '本地充值',
      })
      setBalance(next.balance)
      setRecords(next.records)
      setNotice(`已充值 ${Number(amount).toLocaleString()} tokens`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function consume(amount: number) {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const next = await window.api.billing.mockConsume({
        amount: Number(amount),
        title: '模拟扣费',
      })
      setBalance(next.balance)
      setRecords(next.records)
      setNotice(`已扣除 ${Number(amount).toLocaleString()} tokens`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 980 }}>
      <h2 style={{ margin: 0 }}>余额与充值</h2>

      {error ? (
        <div style={{ color: 'rgba(255,120,120,0.95)' }}>
          错误：<InlineCode>{error}</InlineCode>
        </div>
      ) : null}
      {notice ? (
        <div style={{ color: 'rgba(165,255,195,0.9)' }}>
          提示：<InlineCode>{notice}</InlineCode>
        </div>
      ) : null}

      <Card
        title="Token 余额"
        right={
          <Button onClick={() => void refresh()} disabled={loading || working}>
            刷新
          </Button>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 0.4 }}>{loading ? '...' : balance.toLocaleString()}</div>
          <div style={{ color: 'rgba(255,255,255,0.66)', fontSize: 12 }}>余额仅保存在本地账本中（不涉及真实支付）。</div>
        </div>
      </Card>

      <Card title="本地充值（tokens）">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rechargePresets.map((amount) => (
              <Button key={amount} onClick={() => void recharge(amount)} disabled={working} variant="default">
                +{amount.toLocaleString()}
              </Button>
            ))}
          </div>
          <Field label="自定义充值数量（tokens）">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <NumberInput value={customRecharge} onChange={setCustomRecharge} min={1} max={50000000} />
              <Button
                onClick={() => void recharge(customRecharge)}
                disabled={working || !Number.isFinite(customRecharge) || customRecharge <= 0}
                variant="primary"
              >
                充值
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <Card title="模拟扣费（可选）">
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="扣费数量（tokens）">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <NumberInput value={customConsume} onChange={setCustomConsume} min={1} max={50000000} />
              <Button
                onClick={() => void consume(customConsume)}
                disabled={working || !Number.isFinite(customConsume) || customConsume <= 0}
                variant="danger"
              >
                扣费
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <Card title="最近账单记录">
        {records.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.68)' }}>暂无记录</div>
        ) : (
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 120px 140px 180px',
                gap: 8,
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.03)',
                fontSize: 12,
                color: 'rgba(255,255,255,0.72)',
              }}
            >
              <div>类型</div>
              <div>标题</div>
              <div>变动</div>
              <div>余额</div>
              <div>时间</div>
            </div>
            {records.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 1fr 120px 140px 180px',
                  gap: 8,
                  padding: '12px',
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  alignItems: 'center',
                }}
              >
                <div>{r.type === 'recharge' ? '充值' : '消费'}</div>
                <div style={{ display: 'grid', gap: 2 }}>
                  <div>{r.title}</div>
                  {r.note ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{r.note}</div> : null}
                </div>
                <div style={{ color: r.type === 'recharge' ? 'rgba(165,255,195,0.9)' : 'rgba(255,156,156,0.92)' }}>
                  {r.type === 'recharge' ? '+' : '-'}
                  {r.amount.toLocaleString()}
                </div>
                <div>{r.balanceAfter.toLocaleString()}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>{new Date(r.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
