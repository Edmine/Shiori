/**
 * Pure helpers for Shiori Intelligent UI (`shiori-ui` / `interactive-ui`) fenced blocks.
 *
 * Supports two authoring formats:
 * 1. Direct HTML/CSS/JS inside the code fence (with optional `<!-- title: ... -->` or `<title>`).
 * 2. JSON spec: `{ "title"?: string, "html"?: string, "src"?: string, "height"?: number }`.
 */

export interface InteractiveUiSpec {
  title?: string
  html?: string
  src?: string
  height?: number
}

export interface InteractiveUiThemeSnapshot {
  mode: 'light' | 'dark'
  bg: string
  surface: string
  surfaceRaised: string
  fg: string
  muted: string
  tertiary: string
  border: string
  borderStrong: string
  accent: string
  accentFg: string
  accentTint: string
  success: string
  info: string
  danger: string
  fontSans: string
  fontMono: string
}

export type InteractiveUiBridgeMessage =
  | { type: 'resize'; height: number }
  | { type: 'action'; message: string; label?: string; data?: unknown }
  | { type: 'copy'; text: string }

export const INTERACTIVE_UI_CHANNEL = 'shiori-ui-v1'
export const INTERACTIVE_UI_MIN_HEIGHT = 120
export const INTERACTIVE_UI_MAX_HEIGHT = 760
export const INTERACTIVE_UI_DEFAULT_HEIGHT = 320

export function clampInteractiveUiHeight(height: number): number {
  if (!Number.isFinite(height)) return INTERACTIVE_UI_DEFAULT_HEIGHT
  return Math.max(INTERACTIVE_UI_MIN_HEIGHT, Math.min(INTERACTIVE_UI_MAX_HEIGHT, Math.ceil(height)))
}

export function parseInteractiveUiSpec(code: string): InteractiveUiSpec | null {
  const trimmed = code.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const html = typeof parsed.html === 'string' ? parsed.html : undefined
        const src = typeof parsed.src === 'string' ? parsed.src : undefined
        if (html || src) {
          return {
            title: typeof parsed.title === 'string' ? parsed.title.trim() || undefined : undefined,
            html,
            src,
            height: typeof parsed.height === 'number' ? clampInteractiveUiHeight(parsed.height) : undefined,
          }
        }
      }
    } catch {
      // Not valid JSON — fall through and treat as raw HTML if it looks like markup
    }
  }

  // Raw HTML/CSS/JS fragment or full HTML document
  const commentTitle = trimmed.match(/<!--\s*title\s*:\s*([^-\n][^>]*?)\s*-->/i)?.[1]?.trim()
  const tagTitle = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
  const commentHeightRaw = trimmed.match(/<!--\s*height\s*:\s*(\d{2,4})\s*-->/i)?.[1]
  const commentHeight = commentHeightRaw ? clampInteractiveUiHeight(Number(commentHeightRaw)) : undefined

  return {
    title: commentTitle || tagTitle || undefined,
    html: trimmed,
    height: commentHeight,
  }
}

export function getDefaultThemeSnapshot(mode: 'light' | 'dark' = 'light'): InteractiveUiThemeSnapshot {
  if (mode === 'dark') {
    return {
      mode: 'dark',
      bg: '#1c1b18',
      surface: '#242320',
      surfaceRaised: '#2a2925',
      fg: '#eceae4',
      muted: '#b9b6ae',
      tertiary: '#8c8980',
      border: 'rgba(236, 234, 228, 0.11)',
      borderStrong: 'rgba(236, 234, 228, 0.2)',
      accent: '#4a9aa3',
      accentFg: '#ffffff',
      accentTint: 'rgba(74, 154, 163, 0.16)',
      success: '#4ea36d',
      info: '#e3a64a',
      danger: '#de5b55',
      fontSans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    }
  }

  return {
    mode: 'light',
    bg: '#faf9f6',
    surface: '#f2f1ee',
    surfaceRaised: '#ffffff',
    fg: '#1c1b18',
    muted: '#43423e',
    tertiary: '#5d5c59',
    border: 'rgba(28, 27, 24, 0.1)',
    borderStrong: 'rgba(28, 27, 24, 0.18)',
    accent: '#286b73',
    accentFg: '#ffffff',
    accentTint: 'rgba(40, 107, 115, 0.1)',
    success: '#348554',
    info: '#a46a00',
    danger: '#c4403b',
    fontSans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  }
}

export function readHostThemeSnapshot(): InteractiveUiThemeSnapshot {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return getDefaultThemeSnapshot('light')
  }
  const root = document.documentElement
  const isDark = root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark'
  const fallback = getDefaultThemeSnapshot(isDark ? 'dark' : 'light')
  const style = window.getComputedStyle(root)
  const pick = (name: string, fb: string) => {
    const value = style.getPropertyValue(name).trim()
    return value || fb
  }

  return {
    mode: isDark ? 'dark' : 'light',
    bg: pick('--surface-paper', pick('--background', fallback.bg)),
    surface: pick('--surface-sunken', fallback.surface),
    surfaceRaised: pick('--surface-raised', fallback.surfaceRaised),
    fg: pick('--text', pick('--foreground', fallback.fg)),
    muted: pick('--text-secondary', fallback.muted),
    tertiary: pick('--text-tertiary', fallback.tertiary),
    border: pick('--border', fallback.border),
    borderStrong: pick('--border-strong', fallback.borderStrong),
    accent: pick('--accent-solid', pick('--accent-raw', fallback.accent)),
    accentFg: pick('--on-accent', fallback.accentFg),
    accentTint: pick('--accent-tint', fallback.accentTint),
    success: pick('--success-solid', pick('--success-raw', fallback.success)),
    info: pick('--info-solid', pick('--info-raw', fallback.info)),
    danger: pick('--destructive-solid', pick('--destructive-raw', fallback.danger)),
    fontSans: pick('--font-sans', fallback.fontSans),
    fontMono: pick('--font-mono', fallback.fontMono),
  }
}

function serializeCssVars(theme: InteractiveUiThemeSnapshot): string {
  return [
    `color-scheme: ${theme.mode};`,
    `--bg: ${theme.bg};`,
    `--surface: ${theme.surface};`,
    `--surface-raised: ${theme.surfaceRaised};`,
    `--fg: ${theme.fg};`,
    `--muted: ${theme.muted};`,
    `--tertiary: ${theme.tertiary};`,
    `--border: ${theme.border};`,
    `--border-strong: ${theme.borderStrong};`,
    `--accent: ${theme.accent};`,
    `--accent-fg: ${theme.accentFg};`,
    `--accent-tint: ${theme.accentTint};`,
    `--success: ${theme.success};`,
    `--info: ${theme.info};`,
    `--danger: ${theme.danger};`,
    `--font-sans: ${theme.fontSans};`,
    `--font-mono: ${theme.fontMono};`,
    `--shiori-bg: ${theme.bg};`,
    `--shiori-surface: ${theme.surface};`,
    `--shiori-fg: ${theme.fg};`,
    `--shiori-muted: ${theme.muted};`,
    `--shiori-border: ${theme.border};`,
    `--shiori-accent: ${theme.accent};`,
  ].join('\n    ')
}

const STRICT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

function buildBridgeHeadHtml(instanceId: string, theme: InteractiveUiThemeSnapshot): string {
  const safeInstanceId = JSON.stringify(instanceId)
  const safeChannel = JSON.stringify(INTERACTIVE_UI_CHANNEL)

  return `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${STRICT_CSP}" />
<style data-shiori-base="true">
  :root {
    ${serializeCssVars(theme)}
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  body {
    padding: 16px;
    overflow-x: auto;
  }
  h1, h2, h3, h4 {
    margin: 0 0 8px 0;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
  }
  p { margin: 0 0 10px 0; color: var(--muted); }
  button, .btn {
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease, transform 80ms ease;
  }
  button:hover, .btn:hover { border-color: var(--border-strong); }
  button:active, .btn:active { transform: scale(0.98); }
  button.primary, button[data-primary], .btn-primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: transparent;
  }
  button.primary:hover, button[data-primary]:hover, .btn-primary:hover {
    filter: brightness(1.06);
  }
  input, select, textarea {
    font: inherit;
    font-size: 13px;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    outline: none;
  }
  input:focus, select:focus, textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-tint);
  }
  input[type="range"] {
    padding: 0;
    border: none;
    background: transparent;
    accent-color: var(--accent);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th, td {
    text-align: left;
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
  }
  th {
    font-weight: 600;
    color: var(--muted);
    background: var(--surface);
  }
  code, pre {
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
</style>
<script data-shiori-bridge="true">
(function() {
  var CHANNEL = ${safeChannel};
  var INSTANCE_ID = ${safeInstanceId};
  function post(payload) {
    try {
      window.parent.postMessage(Object.assign({ channel: CHANNEL, instanceId: INSTANCE_ID }, payload), '*');
    } catch (e) {}
  }
  var lastHeight = 0;
  var resizeTimer = null;
  function reportHeight() {
    var body = document.body;
    var docEl = document.documentElement;
    if (!body || !docEl) return;
    var h = Math.max(body.scrollHeight, body.offsetHeight, docEl.scrollHeight);
    if (h > 0 && Math.abs(h - lastHeight) >= 2) {
      lastHeight = h;
      post({ type: 'resize', height: h });
    }
  }
  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(reportHeight, 40);
  }
  window.shiori = {
    send: function(message, options) {
      var opts = options || {};
      post({
        type: 'action',
        message: typeof message === 'string' ? message : String(message || ''),
        label: typeof opts.label === 'string' ? opts.label : undefined,
        data: opts.data
      });
    },
    sendAction: function(action, data, message) {
      post({
        type: 'action',
        label: typeof action === 'string' ? action : String(action || ''),
        message: typeof message === 'string' ? message : '',
        data: data
      });
    },
    copy: function(text) {
      post({ type: 'copy', text: typeof text === 'string' ? text : String(text || '') });
    },
    resize: reportHeight
  };
  window.addEventListener('message', function(ev) {
    var msg = ev && ev.data;
    if (!msg || msg.channel !== CHANNEL || msg.instanceId !== INSTANCE_ID) return;
    if (msg.type === 'theme' && msg.vars && typeof msg.vars === 'object') {
      var rootStyle = document.documentElement.style;
      if (msg.mode === 'dark' || msg.mode === 'light') {
        rootStyle.colorScheme = msg.mode;
      }
      Object.keys(msg.vars).forEach(function(k) {
        rootStyle.setProperty(k, String(msg.vars[k]));
      });
      window.dispatchEvent(new CustomEvent('shiori:theme', { detail: { mode: msg.mode, vars: msg.vars } }));
    }
  });
  document.addEventListener('click', function(ev) {
    var target = ev.target && ev.target.closest ? ev.target.closest('[data-shiori-send]') : null;
    if (!target) return;
    var prompt = target.getAttribute('data-shiori-send') || '';
    var label = target.getAttribute('data-shiori-label') || (target.textContent || '').trim();
    var rawData = target.getAttribute('data-shiori-data');
    var parsedData;
    if (rawData) {
      try { parsedData = JSON.parse(rawData); } catch (e) { parsedData = rawData; }
    }
    window.shiori.send(prompt, { label: label, data: parsedData });
  });
  document.addEventListener('submit', function(ev) {
    var form = ev.target;
    if (!form || !form.matches || !form.matches('form[data-shiori-form]')) return;
    ev.preventDefault();
    var fd = new FormData(form);
    var data = {};
    fd.forEach(function(val, key) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        data[key] = Array.isArray(data[key]) ? data[key].concat([val]) : [data[key], val];
      } else {
        data[key] = val;
      }
    });
    var prompt = form.getAttribute('data-shiori-form') || '已提交交互表单，请基于以下选择继续：';
    var label = form.getAttribute('data-shiori-label') || '提交表单';
    window.shiori.send(prompt, { label: label, data: data });
  });
  window.addEventListener('DOMContentLoaded', function() {
    reportHeight();
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      new ResizeObserver(scheduleResize).observe(document.body);
    }
    if (typeof MutationObserver !== 'undefined' && document.body) {
      new MutationObserver(scheduleResize).observe(document.body, { childList: true, subtree: true, attributes: true });
    }
  });
  window.addEventListener('load', function() {
    reportHeight();
    setTimeout(reportHeight, 120);
  });
})();
</script>`
}

export function buildThemePostMessage(instanceId: string, theme: InteractiveUiThemeSnapshot) {
  return {
    channel: INTERACTIVE_UI_CHANNEL,
    instanceId,
    type: 'theme',
    mode: theme.mode,
    vars: {
      '--bg': theme.bg,
      '--surface': theme.surface,
      '--surface-raised': theme.surfaceRaised,
      '--fg': theme.fg,
      '--muted': theme.muted,
      '--tertiary': theme.tertiary,
      '--border': theme.border,
      '--border-strong': theme.borderStrong,
      '--accent': theme.accent,
      '--accent-fg': theme.accentFg,
      '--accent-tint': theme.accentTint,
      '--success': theme.success,
      '--info': theme.info,
      '--danger': theme.danger,
      '--shiori-bg': theme.bg,
      '--shiori-surface': theme.surface,
      '--shiori-fg': theme.fg,
      '--shiori-muted': theme.muted,
      '--shiori-border': theme.border,
      '--shiori-accent': theme.accent,
    },
  }
}

export function buildInteractiveUiDocument(
  rawHtml: string,
  options: { instanceId: string; theme: InteractiveUiThemeSnapshot },
): string {
  const headInject = buildBridgeHeadHtml(options.instanceId, options.theme)
  const trimmed = rawHtml.trim()

  if (/<head(?:\s[^>]*)?>/i.test(trimmed)) {
    return trimmed.replace(/(<head(?:\s[^>]*)?>)/i, `$1\n${headInject}\n`)
  }
  if (/<html(?:\s[^>]*)?>/i.test(trimmed)) {
    return trimmed.replace(/(<html(?:\s[^>]*)?>)/i, `$1\n<head>\n${headInject}\n</head>\n`)
  }
  return `<!DOCTYPE html>
<html>
<head>
${headInject}
</head>
<body>
${trimmed}
</body>
</html>`
}

/**
 * Build a self-contained HTML file suitable for exporting/opening standalone in any browser.
 * Preserves Shiori's theme variables and base stylesheet, and provides a safe stub `window.shiori`.
 */
export function buildStandaloneExportHtml(
  rawHtml: string,
  options: { title?: string; theme: InteractiveUiThemeSnapshot },
): string {
  const safeTitle = (options.title || 'Shiori Interactive View')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const headInject = `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style data-shiori-export="true">
  :root {
    ${serializeCssVars(options.theme)}
  }
  :where(*, *::before, *::after) { box-sizing: border-box; }
  :where(html, body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  :where(button, .btn) {
    font: inherit; font-size: 13px; font-weight: 500; color: var(--fg);
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 6px 12px; cursor: pointer;
  }
  :where(button.primary, button[data-primary], .btn-primary) {
    background: var(--accent); color: var(--accent-fg); border-color: transparent;
  }
  :where(input, select, textarea) {
    font: inherit; font-size: 13px; color: var(--fg); background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px;
  }
  :where(table) { width: 100%; border-collapse: collapse; font-size: 13px; }
  :where(th, td) { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); }
  :where(th) { font-weight: 600; color: var(--muted); background: var(--surface); }
  :where(.card) { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
</style>
<script>
window.shiori = window.shiori || {
  send: function(msg, opts) { console.info('[Shiori standalone export] send:', msg, opts); },
  sendAction: function(action, data, msg) { console.info('[Shiori standalone export] sendAction:', action, data, msg); },
  copy: function(text) { if (navigator.clipboard) navigator.clipboard.writeText(String(text || '')); },
  resize: function() {}
};
</script>`

  const trimmed = rawHtml.trim()
  if (/<head(?:\s[^>]*)?>/i.test(trimmed)) {
    return trimmed.replace(/(<head(?:\s[^>]*)?>)/i, `$1\n${headInject}\n`)
  }
  if (/<html(?:\s[^>]*)?>/i.test(trimmed)) {
    return trimmed.replace(/(<html(?:\s[^>]*)?>)/i, `$1\n<head>\n${headInject}\n</head>\n`)
  }
  return `<!DOCTYPE html>
<html>
<head>
${headInject}
</head>
<body>
${trimmed}
</body>
</html>`
}

export function toExportHtmlFilename(title?: string): string {
  const cleaned = (title || 'shiori-view')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${cleaned || 'shiori-view'}.html`
}
export function parseInteractiveUiBridgeMessage(
  raw: unknown,
  expectedInstanceId: string,
): InteractiveUiBridgeMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as Record<string, unknown>
  if (msg.channel !== INTERACTIVE_UI_CHANNEL || msg.instanceId !== expectedInstanceId) {
    return null
  }

  if (msg.type === 'resize' && typeof msg.height === 'number' && Number.isFinite(msg.height)) {
    return { type: 'resize', height: clampInteractiveUiHeight(msg.height) }
  }

  if (msg.type === 'action') {
    const message = typeof msg.message === 'string' ? msg.message.trim() : ''
    const label = typeof msg.label === 'string' ? msg.label.trim() : undefined
    const data = msg.data
    if (!message && !label && data === undefined) return null
    return { type: 'action', message, label, data }
  }

  if (msg.type === 'copy' && typeof msg.text === 'string' && msg.text.length > 0) {
    return { type: 'copy', text: msg.text.slice(0, 50_000) }
  }

  return null
}
