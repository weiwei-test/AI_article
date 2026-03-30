import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Field, InlineCode, TextInput } from '../components/ui'

type ModelInfo = { id: string; owned_by?: string }

type ModelTarget = 'text' | 'image' | 'video'
type DetectState = { type: 'success' | 'error'; message: string } | null

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [textBaseUrl, setTextBaseUrl] = useState('')
  const [textApiKeyInput, setTextApiKeyInput] = useState('')
  const [textModelId, setTextModelId] = useState('')
  const [hasTextApiKey, setHasTextApiKey] = useState(false)

  const [imageBaseUrl, setImageBaseUrl] = useState('')
  const [imageApiKeyInput, setImageApiKeyInput] = useState('')
  const [imageModelId, setImageModelId] = useState('')
  const [hasImageApiKey, setHasImageApiKey] = useState(false)

  const [videoBaseUrl, setVideoBaseUrl] = useState('')
  const [videoApiKeyInput, setVideoApiKeyInput] = useState('')
  const [videoModelId, setVideoModelId] = useState('')
  const [hasVideoApiKey, setHasVideoApiKey] = useState(false)

  const [adminAppKeyInput, setAdminAppKeyInput] = useState('')
  const [hasAdminAppKey, setHasAdminAppKey] = useState(false)
  const [publisherUrl, setPublisherUrl] = useState('')

  const [modelsLoading, setModelsLoading] = useState<ModelTarget | ''>('')
  const [textModels, setTextModels] = useState<ModelInfo[]>([])
  const [imageModels, setImageModels] = useState<ModelInfo[]>([])
  const [videoModels, setVideoModels] = useState<ModelInfo[]>([])
  const [detectState, setDetectState] = useState<Record<ModelTarget, DetectState>>({
    text: null,
    image: null,
    video: null,
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const s = await window.api.settings.get()
        if (cancelled) return
        setTextBaseUrl(s.baseUrl ?? '')
        setTextModelId(s.modelId ?? '')
        setImageBaseUrl(s.imageBaseUrl ?? '')
        setImageModelId(s.coverModelId ?? '')
        setVideoBaseUrl(s.videoBaseUrl ?? '')
        setVideoModelId(s.videoModelId ?? '')
        setPublisherUrl(s.publisherUrl ?? '')
        setHasTextApiKey(Boolean(s.hasApiKey))
        setHasImageApiKey(Boolean(s.hasImageApiKey))
        setHasVideoApiKey(Boolean(s.hasVideoApiKey))
        setHasAdminAppKey(Boolean(s.hasAdminAppKey))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const canSave = useMemo(() => {
    return !loading && Boolean(textBaseUrl.trim())
  }, [loading, textBaseUrl])

  async function save(
    patch: {
      clearTextApiKey?: boolean
      clearImageApiKey?: boolean
      clearVideoApiKey?: boolean
      clearAdminKey?: boolean
    } = {},
  ) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const textApiKey = patch.clearTextApiKey ? '' : textApiKeyInput.trim() ? textApiKeyInput.trim() : undefined
      const imageApiKey = patch.clearImageApiKey ? '' : imageApiKeyInput.trim() ? imageApiKeyInput.trim() : undefined
      const videoApiKey = patch.clearVideoApiKey ? '' : videoApiKeyInput.trim() ? videoApiKeyInput.trim() : undefined
      const adminAppKey = patch.clearAdminKey ? '' : adminAppKeyInput.trim() ? adminAppKeyInput.trim() : undefined

      const s = await window.api.settings.set({
        baseUrl: textBaseUrl.trim(),
        modelId: textModelId.trim(),
        imageBaseUrl: imageBaseUrl.trim(),
        coverModelId: imageModelId.trim(),
        videoBaseUrl: videoBaseUrl.trim(),
        videoModelId: videoModelId.trim(),
        apiKey: textApiKey,
        imageApiKey,
        videoApiKey,
        adminAppKey,
        publisherUrl: publisherUrl.trim(),
      })

      setHasTextApiKey(Boolean(s.hasApiKey))
      setHasImageApiKey(Boolean(s.hasImageApiKey))
      setHasVideoApiKey(Boolean(s.hasVideoApiKey))
      setHasAdminAppKey(Boolean(s.hasAdminAppKey))
      setTextApiKeyInput('')
      setImageApiKeyInput('')
      setVideoApiKeyInput('')
      setAdminAppKeyInput('')
      setNotice('配置已保存')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function detectModels(target: ModelTarget) {
    setModelsLoading(target)
    setError('')
    setNotice('')
    setDetectState((prev) => ({ ...prev, [target]: null }))
    try {
      await save()
      const list = await window.api.settings.listModels({ target })
      if (target === 'text') {
        setTextModels(list)
        if (!textModelId && list[0]?.id) setTextModelId(list[0].id)
      } else if (target === 'image') {
        setImageModels(list)
        if (!imageModelId) {
          const hit = list.find((m) => /image|imagine|paint|flux|sdxl|vision|cover|wanx/i.test(m.id))?.id || list[0]?.id
          if (hit) setImageModelId(hit)
        }
      } else {
        setVideoModels(list)
        if (!videoModelId) {
          const hit = list.find((m) => /video/i.test(m.id))?.id || list[0]?.id
          if (hit) setVideoModelId(hit)
        }
      }
      setDetectState((prev) => ({
        ...prev,
        [target]: { type: 'success', message: `检测成功，发现 ${list.length} 个模型` },
      }))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      setDetectState((prev) => ({
        ...prev,
        [target]: { type: 'error', message: `检测失败：${message}` },
      }))
    } finally {
      setModelsLoading('')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0 }}>设置</h2>
        <Button onClick={() => void save()} disabled={!canSave || saving} variant="primary">
          {saving ? '保存中...' : '保存全部配置'}
        </Button>
      </div>

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
        title="文字模型配置"
        right={
          <Button onClick={() => void detectModels('text')} disabled={loading || saving || modelsLoading !== ''} variant="default">
            {modelsLoading === 'text' ? '检测中...' : '检测文字模型'}
          </Button>
        }
      >
        <Field label="文字 URL" hint="用于小说生成、元数据生成、分镜生成等文本能力。">
          <TextInput value={textBaseUrl} onChange={setTextBaseUrl} placeholder="http://localhost:11434" />
        </Field>
        <Field label="文字 API Key" hint={hasTextApiKey ? '已保存（本地加密），留空表示不修改。' : '尚未保存。'}>
          <TextInput value={textApiKeyInput} onChange={setTextApiKeyInput} placeholder="sk-..." type="password" />
          <Button onClick={() => void save({ clearTextApiKey: true })} disabled={loading || saving} variant="danger">
            清除文字 API Key
          </Button>
        </Field>
        <Field label="文字模型 ID">
          <TextInput value={textModelId} onChange={setTextModelId} placeholder="gpt-4o-mini / qwen2.5 / ..." />
          {detectState.text ? (
            <div style={{ marginTop: 6, color: detectState.text.type === 'success' ? 'rgba(165, 255, 195, 0.9)' : 'rgba(255, 120, 120, 0.92)' }}>
              {detectState.text.message}
            </div>
          ) : null}
          {textModels.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {textModels.slice(0, 40).map((m) => (
                <Button key={m.id} onClick={() => setTextModelId(m.id)} variant={m.id === textModelId ? 'primary' : 'default'}>
                  {m.id}
                </Button>
              ))}
            </div>
          ) : null}
        </Field>
      </Card>

      <Card
        title="图片模型配置"
        right={
          <Button onClick={() => void detectModels('image')} disabled={loading || saving || modelsLoading !== ''} variant="default">
            {modelsLoading === 'image' ? '检测中...' : '检测图片模型'}
          </Button>
        }
      >
        <Field label="图片 URL" hint="用于封面出图。为空时会回退到文字 URL。">
          <TextInput value={imageBaseUrl} onChange={setImageBaseUrl} placeholder="http://localhost:8000" />
        </Field>
        <Field label="图片 API Key" hint={hasImageApiKey ? '已保存（本地加密），留空表示不修改。' : '尚未保存。为空时会回退到文字 API Key。'}>
          <TextInput value={imageApiKeyInput} onChange={setImageApiKeyInput} placeholder="sk-..." type="password" />
          <Button onClick={() => void save({ clearImageApiKey: true })} disabled={loading || saving} variant="danger">
            清除图片 API Key
          </Button>
        </Field>
        <Field label="图片模型 ID">
          <TextInput value={imageModelId} onChange={setImageModelId} placeholder="grok-imagine-1.0 / gpt-image-1 / flux / wanx" />
          {detectState.image ? (
            <div style={{ marginTop: 6, color: detectState.image.type === 'success' ? 'rgba(165, 255, 195, 0.9)' : 'rgba(255, 120, 120, 0.92)' }}>
              {detectState.image.message}
            </div>
          ) : null}
          {imageModels.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {imageModels
                .filter((m) => /image|imagine|paint|flux|sdxl|vision|cover|wanx/i.test(m.id))
                .concat(imageModels.filter((m) => !/image|imagine|paint|flux|sdxl|vision|cover|wanx/i.test(m.id)))
                .slice(0, 40)
                .map((m) => (
                  <Button key={m.id} onClick={() => setImageModelId(m.id)} variant={m.id === imageModelId ? 'primary' : 'default'}>
                    {m.id}
                  </Button>
                ))}
            </div>
          ) : null}
        </Field>
      </Card>

      <Card
        title="视频模型配置"
        right={
          <Button onClick={() => void detectModels('video')} disabled={loading || saving || modelsLoading !== ''} variant="default">
            {modelsLoading === 'video' ? '检测中...' : '检测视频模型'}
          </Button>
        }
      >
        <Field label="视频 URL" hint="用于视频生成。为空时会回退到文字 URL。">
          <TextInput value={videoBaseUrl} onChange={setVideoBaseUrl} placeholder="http://localhost:8317/v1" />
        </Field>
        <Field label="视频 API Key" hint={hasVideoApiKey ? '已保存（本地加密），留空表示不修改。' : '尚未保存。为空时会回退到文字 API Key。'}>
          <TextInput value={videoApiKeyInput} onChange={setVideoApiKeyInput} placeholder="sk-..." type="password" />
          <Button onClick={() => void save({ clearVideoApiKey: true })} disabled={loading || saving} variant="danger">
            清除视频 API Key
          </Button>
        </Field>
        <Field label="视频模型 ID">
          <TextInput value={videoModelId} onChange={setVideoModelId} placeholder="grok-imagine-1.0-video / ..." />
          {detectState.video ? (
            <div style={{ marginTop: 6, color: detectState.video.type === 'success' ? 'rgba(165, 255, 195, 0.9)' : 'rgba(255, 120, 120, 0.92)' }}>
              {detectState.video.message}
            </div>
          ) : null}
          {videoModels.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {videoModels
                .filter((m) => /video/i.test(m.id))
                .concat(videoModels.filter((m) => !/video/i.test(m.id)))
                .slice(0, 40)
                .map((m) => (
                  <Button key={m.id} onClick={() => setVideoModelId(m.id)} variant={m.id === videoModelId ? 'primary' : 'default'}>
                    {m.id}
                  </Button>
                ))}
            </div>
          ) : null}
        </Field>
      </Card>

      <Card title="发布与高级配置">
        <Field
          label="Grok2api Admin Key（可选）"
          hint={
            hasAdminAppKey
              ? '已保存（本地加密），留空表示不修改。'
              : '用于自动设置 app_url / LOCAL，减少视频下载时外链问题。'
          }
        >
          <TextInput value={adminAppKeyInput} onChange={setAdminAppKeyInput} placeholder="grok2api" type="password" />
          <Button onClick={() => void save({ clearAdminKey: true })} disabled={loading || saving} variant="danger">
            清除 Admin Key
          </Button>
        </Field>

        <Field label="番茄作者后台 URL">
          <TextInput value={publisherUrl} onChange={setPublisherUrl} placeholder="https://fanqienovel.com/main/writer/home" />
        </Field>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => void window.api.publisher.open()} variant="primary">
            打开发布窗口
          </Button>
          <Button onClick={() => void window.api.os.openExternal({ url: publisherUrl })}>系统浏览器打开</Button>
        </div>
      </Card>
    </div>
  )
}
