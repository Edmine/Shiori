import { describe, expect, it } from 'bun:test'
import {
  INTERACTIVE_UI_CHANNEL,
  buildInteractiveUiDocument,
  buildStandaloneExportHtml,
  clampInteractiveUiHeight,
  getDefaultThemeSnapshot,
  parseInteractiveUiBridgeMessage,
  parseInteractiveUiSpec,
  toExportHtmlFilename,
} from '../interactive-ui-helpers'
import { formatInteractiveUiActionMessage } from '../InteractiveUiContext'

describe('parseInteractiveUiSpec', () => {
  it('parses raw HTML with comment title and height', () => {
    const code = '<!-- title: 预算计算器 -->\n<!-- height: 420 -->\n<div>Hello</div>'
    const spec = parseInteractiveUiSpec(code)
    expect(spec).toEqual({
      title: '预算计算器',
      html: code,
      height: 420,
    })
  })

  it('extracts title from HTML <title> tag when comment title is absent', () => {
    const code = '<html><head><title>利率对比</title></head><body><p>ok</p></body></html>'
    const spec = parseInteractiveUiSpec(code)
    expect(spec?.title).toBe('利率对比')
    expect(spec?.html).toBe(code)
  })

  it('parses JSON spec with file-backed src and clamps height', () => {
    const spec = parseInteractiveUiSpec(JSON.stringify({
      title: 'Dashboard',
      src: '/tmp/widget.html',
      height: 5000,
    }))
    expect(spec).toEqual({
      title: 'Dashboard',
      html: undefined,
      src: '/tmp/widget.html',
      height: clampInteractiveUiHeight(5000),
    })
  })

  it('returns null for empty content', () => {
    expect(parseInteractiveUiSpec('   \n  ')).toBeNull()
  })
})

describe('buildInteractiveUiDocument', () => {
  it('injects strict CSP, Shiori theme variables, and window.shiori bridge', () => {
    const doc = buildInteractiveUiDocument('<button data-shiori-send="确认方案 A">选 A</button>', {
      instanceId: 'inst-42',
      theme: getDefaultThemeSnapshot('dark'),
    })
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("connect-src 'none'")
    expect(doc).toContain('--accent: #4a9aa3;')
    expect(doc).toContain('window.shiori = {')
    expect(doc).toContain('"inst-42"')
    expect(doc).toContain('data-shiori-send="确认方案 A"')
  })

  it('builds standalone exportable HTML with safe filename', () => {
    const exported = buildStandaloneExportHtml('<div>Budget</div>', {
      title: '周末预算 / 方案:1',
      theme: getDefaultThemeSnapshot('light'),
    })
    expect(exported).toContain('<title>周末预算 / 方案:1</title>')
    expect(exported).toContain('--bg: #faf9f6;')
    expect(exported).toContain('window.shiori = window.shiori ||')
    expect(toExportHtmlFilename('周末预算 / 方案:1')).toBe('周末预算-方案1.html')
  })
})

describe('parseInteractiveUiBridgeMessage', () => {
  it('accepts valid resize, action, and copy messages matching instanceId', () => {
    expect(
      parseInteractiveUiBridgeMessage({ channel: INTERACTIVE_UI_CHANNEL, instanceId: 'w1', type: 'resize', height: 280.2 }, 'w1'),
    ).toEqual({ type: 'resize', height: 281 })

    expect(
      parseInteractiveUiBridgeMessage(
        { channel: INTERACTIVE_UI_CHANNEL, instanceId: 'w1', type: 'action', message: '选择方案 B', label: '确认', data: { plan: 'B' } },
        'w1',
      ),
    ).toEqual({ type: 'action', message: '选择方案 B', label: '确认', data: { plan: 'B' } })

    expect(
      parseInteractiveUiBridgeMessage({ channel: INTERACTIVE_UI_CHANNEL, instanceId: 'w1', type: 'copy', text: 'abc' }, 'w1'),
    ).toEqual({ type: 'copy', text: 'abc' })
  })

  it('rejects messages with mismatched channel or instanceId', () => {
    expect(
      parseInteractiveUiBridgeMessage({ channel: INTERACTIVE_UI_CHANNEL, instanceId: 'other', type: 'action', message: 'hi' }, 'w1'),
    ).toBeNull()
    expect(
      parseInteractiveUiBridgeMessage({ channel: 'wrong', instanceId: 'w1', type: 'action', message: 'hi' }, 'w1'),
    ).toBeNull()
  })
})

describe('formatInteractiveUiActionMessage', () => {
  it('formats message with optional structured JSON payload', () => {
    const formatted = formatInteractiveUiActionMessage({
      message: '请按以下参数生成配置：',
      data: { region: 'Tokyo', replicas: 3 },
    })
    expect(formatted).toContain('请按以下参数生成配置：')
    expect(formatted).toContain('"region": "Tokyo"')
    expect(formatted).toContain('"replicas": 3')
  })

  it('falls back to widgetTitle and label when message is empty', () => {
    const formatted = formatInteractiveUiActionMessage({
      message: '',
      widgetTitle: '部署向导',
      label: '应用到生产',
      data: { env: 'prod' },
    })
    expect(formatted).toContain('[部署向导] 应用到生产')
    expect(formatted).toContain('"env": "prod"')
  })
})
