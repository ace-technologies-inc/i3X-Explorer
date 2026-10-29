import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { getClient, type InspectedResponse } from '../../api/client'
import {
  renderSnippet,
  resolveHeaders,
  SNIPPET_RENDERERS,
  type SnippetTarget,
} from '../../api/snippets'
import { buildUrl } from '../../api/snippets/types'
import { CloseIcon } from '../common/icons'
import { Spinner } from '../common/Spinner'
import { CopyButton } from './CopyButton'
import type { RequestInspectorTab } from './requestTabs'

const LANGUAGE_STORAGE_KEY = 'i3x-explorer:code-sample-language'
const REDACT_STORAGE_KEY = 'i3x-explorer:code-sample-redact'
const MIN_RESPONSE_HEIGHT = 112
const DEFAULT_RESPONSE_HEIGHT = 208
const MIN_REQUEST_HEIGHT = 120

function readStoredLanguage(): SnippetTarget {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as SnippetTarget | null
  if (stored && SNIPPET_RENDERERS.some(r => r.id === stored)) return stored
  return SNIPPET_RENDERERS[0].id
}

/**
 * A conservative, dependency-free highlighter: it colours quoted strings,
 * numbers, boolean/null atoms and leading HTTP verbs, and leaves everything
 * else untouched. That is enough to make a JSON body and a request line
 * readable at a glance across all six target languages without the risk (or the
 * weight) of a real per-language grammar.
 */
const TOKEN =
  /("(?:[^"\\]|\\.)*")|\b(GET|POST|PUT|DELETE|PATCH)\b|\b(true|false|null|None|True|False|nil)\b|(-?\d+\.?\d*)/g

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of code.matchAll(TOKEN)) {
    const index = m.index ?? 0
    if (index > last) out.push(code.slice(last, index))
    const [full, str, verb, atom, num] = m
    if (str) out.push(<span key={key++} className="text-i3x-warning">{str}</span>)
    else if (verb) out.push(<span key={key++} className="text-i3x-success font-semibold">{verb}</span>)
    else if (atom) out.push(<span key={key++} className="text-i3x-primary">{atom}</span>)
    else if (num) out.push(<span key={key++} className="text-i3x-violet">{num}</span>)
    else out.push(full)
    last = index + full.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

function formatResponseBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body || '(No response body)'
  }
}

interface RequestInspectorModalProps {
  /** Object / namespace / type name shown in the header. */
  title: string
  /** Kind label, e.g. 'Object Instance'. */
  subtitle?: string
  tabs: RequestInspectorTab[]
  initialTabId?: string
  onClose: () => void
}

/**
 * The Request Inspector: an IDE-style modal for reading the exact HTTP request a
 * detail view issues, in any supported language. It renders only from the
 * `RequestDescriptor`s it is handed — the version-accurate source of truth — so
 * it never fabricates a request. All of its state (active request tab, language,
 * redaction, variant) lives here, isolated from the expensive visualisations
 * behind it, so opening or driving the inspector never re-renders a graph or a
 * chart.
 */
export function RequestInspectorModal({
  title,
  subtitle,
  tabs,
  initialTabId,
  onClose,
}: RequestInspectorModalProps) {
  const [activeTabId, setActiveTabId] = useState<string>(
    () => (tabs.find(t => t.id === initialTabId) ?? tabs[0])?.id ?? ''
  )
  const [language, setLanguage] = useState<SnippetTarget>(readStoredLanguage)
  const [redact, setRedact] = useState<boolean>(
    () => localStorage.getItem(REDACT_STORAGE_KEY) !== 'false'
  )
  const [variantIds, setVariantIds] = useState<Record<string, string>>({})
  const [response, setResponse] = useState<InspectedResponse | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [responseHeight, setResponseHeight] = useState(DEFAULT_RESPONSE_HEIGHT)
  const [isResizingResponse, setIsResizingResponse] = useState(false)
  const codePanelRef = useRef<HTMLDivElement>(null)
  const responseResizeOrigin = useRef<{
    height: number
    maximumHeight: number
    y: number
  } | null>(null)
  const titleId = useId()

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  }, [language])
  useEffect(() => {
    localStorage.setItem(REDACT_STORAGE_KEY, String(redact))
  }, [redact])

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]

  const descriptor = useMemo(() => {
    if (!activeTab) return null
    if (activeTab.variants && activeTab.variants.length > 0) {
      const chosen = activeTab.variants.find(v => v.id === variantIds[activeTab.id])
      return (chosen ?? activeTab.variants[0]).descriptor
    }
    return activeTab.descriptor ?? null
  }, [activeTab, variantIds])

  const client = getClient()
  const baseUrl = client?.getBaseUrl() ?? ''
  const credentials = client?.getCredentials() ?? null

  const { snippet, url, bodyJson, authHeaders, redactedHeaders } = useMemo(() => {
    if (!descriptor) {
      return { snippet: '', url: '', bodyJson: null, authHeaders: [], redactedHeaders: {} }
    }
    const headers = resolveHeaders(descriptor, credentials, redact)
    const rendered = renderSnippet(descriptor, language, { baseUrl, headers })
    const auth = Object.keys(resolveHeaders(descriptor, credentials, false)).filter(
      name => name !== 'Accept' && name !== 'Content-Type'
    )
    return {
      snippet: rendered,
      url: buildUrl(descriptor, baseUrl),
      bodyJson: descriptor.body !== undefined ? JSON.stringify(descriptor.body, null, 2) : null,
      authHeaders: auth,
      redactedHeaders: headers,
    }
  }, [descriptor, language, redact, baseUrl, credentials])

  useEffect(() => {
    setResponse(null)
    setExecutionError(null)
  }, [descriptor])

  const resizeResponse = useCallback((event: MouseEvent) => {
    const origin = responseResizeOrigin.current
    if (!origin) return
    setResponseHeight(
      Math.max(
        MIN_RESPONSE_HEIGHT,
        Math.min(origin.maximumHeight, origin.height + origin.y - event.clientY)
      )
    )
  }, [])

  const stopResizingResponse = useCallback(() => {
    responseResizeOrigin.current = null
    setIsResizingResponse(false)
  }, [])

  useEffect(() => {
    if (!isResizingResponse) return
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', resizeResponse)
    window.addEventListener('mouseup', stopResizingResponse)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', resizeResponse)
      window.removeEventListener('mouseup', stopResizingResponse)
    }
  }, [isResizingResponse, resizeResponse, stopResizingResponse])

  if (!activeTab || !descriptor) return null

  async function executeRequest() {
    if (!client || !descriptor || isExecuting) return
    setIsExecuting(true)
    setResponse(null)
    setExecutionError(null)
    try {
      setResponse(await client.executeDescriptor(descriptor))
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : 'Request could not be completed')
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
        className="flex h-[90vh] w-[90vw] flex-col overflow-hidden rounded-xl border border-i3x-border bg-i3x-surface shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-i3x-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold text-i3x-text">
              Request Inspector
            </h2>
            <p className="truncate text-[11.5px] text-i3x-text-muted" title={title}>
              {title}
              {subtitle && <span className="ml-1.5 opacity-70">· {subtitle}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-i3x-border bg-i3x-bg text-i3x-text-muted hover:text-i3x-text hover:border-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        {/* Request tab bar — only when there is more than one request kind. */}
        {tabs.length > 1 && (
          <div
            role="tablist"
            aria-label="Request type"
            className="flex gap-1 overflow-x-auto border-b border-i3x-border px-3 py-1.5"
          >
            {tabs.map(tab => {
              const selected = tab.id === activeTab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
                    selected
                      ? 'bg-i3x-primary/10 text-i3x-primary'
                      : 'text-i3x-text-muted hover:bg-i3x-bg hover:text-i3x-text'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Summary row — method, endpoint, version. No status/duration: these
            are request shapes, not executed calls, so there is nothing to fake. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-i3x-border bg-i3x-bg px-4 py-2">
          <span className="rounded bg-i3x-success/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-i3x-success">
            {descriptor.method}
          </span>
          <span className="font-mono text-[12.5px] text-i3x-text">{descriptor.path}</span>
          <div className="ml-auto flex items-center gap-2">
            {activeTab.variants && activeTab.variants.length > 1 && (
              <>
              <label className="sr-only" htmlFor={`${titleId}-variant`}>
                {activeTab.variantLabel ?? 'Request variant'}
              </label>
              <select
                id={`${titleId}-variant`}
                value={variantIds[activeTab.id] ?? activeTab.variants[0].id}
                onChange={e =>
                  setVariantIds(prev => ({ ...prev, [activeTab.id]: e.target.value }))
                }
                className="rounded-lg border border-i3x-border bg-i3x-surface px-2 py-1 text-[11.5px] text-i3x-text focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
              >
                {activeTab.variants.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              </>
            )}
            <button
              type="button"
              onClick={executeRequest}
              disabled={!client || isExecuting}
              className="rounded-lg bg-i3x-primary px-3 py-1 text-[11.5px] font-medium text-white hover:bg-i3x-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
            >
              {isExecuting ? 'Running...' : 'Run request'}
            </button>
          </div>
        </div>

        {/* Language tabs + redaction */}
        <div className="flex flex-wrap items-center gap-1 border-b border-i3x-border px-3 py-1.5">
          {SNIPPET_RENDERERS.map(r => {
            const selected = r.id === language
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setLanguage(r.id)}
                aria-pressed={selected}
                className={`rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
                  selected
                    ? 'bg-i3x-text/10 text-i3x-text'
                    : 'text-i3x-text-muted hover:bg-i3x-bg hover:text-i3x-text'
                }`}
              >
                {r.label}
              </button>
            )
          })}
          {authHeaders.length > 0 && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11.5px] text-i3x-text-muted">
              <input
                type="checkbox"
                checked={redact}
                onChange={e => setRedact(e.target.checked)}
                className="accent-i3x-primary"
              />
              Redact key
            </label>
          )}
        </div>

        {/* Body: metadata panel + code viewer */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="shrink-0 overflow-auto border-b border-i3x-border p-4 text-[12px] md:w-64 md:border-b-0 md:border-r">
            <dl className="space-y-3">
              <MetaField label="Request" value={descriptor.title} />
              <MetaField label="Method" value={descriptor.method} mono />
              <MetaField label="Endpoint" value={descriptor.path} mono />
              {descriptor.query &&
                Object.entries(descriptor.query).map(([k, v]) => (
                  <MetaField key={k} label={`Query · ${k}`} value={v} mono />
                ))}
              <MetaField label="Body" value={bodyJson ? 'JSON' : 'None'} />
              <MetaField
                label="Auth"
                value={
                  authHeaders.length > 0
                    ? authHeaders.map(h => `${h}: ${redactedHeaders[h]}`).join('\n')
                    : 'None'
                }
                mono
              />
              {descriptor.note && (
                <div>
                  <dt className="mb-1 text-[11px] uppercase tracking-wide text-i3x-text-muted">
                    Note
                  </dt>
                  <dd className="text-[11.5px] leading-relaxed text-i3x-text-muted">
                    {descriptor.note}
                  </dd>
                </div>
              )}
            </dl>
          </aside>

          <div ref={codePanelRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-i3x-border bg-i3x-surface px-3 py-1.5">
              <span className="font-mono text-[11px] font-semibold text-i3x-success">
                {descriptor.method}
              </span>
              <span className="truncate font-mono text-[11.5px] text-i3x-text-muted" title={url}>
                {url}
              </span>
              <CopyButton
                text={snippet}
                className="ml-auto"
                title="Copy code sample"
              />
            </div>
            <pre className="min-h-0 flex-1 overflow-auto bg-i3x-bg px-4 py-3 font-mono text-[12.5px] leading-relaxed text-i3x-text">
              <code>{highlight(snippet)}</code>
            </pre>
            {(isExecuting || response || executionError) && (
              <>
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize response panel"
                  onMouseDown={event => {
                    event.preventDefault()
                    const paneHeight = codePanelRef.current?.clientHeight ?? 0
                    const maximumHeight =
                      paneHeight > MIN_REQUEST_HEIGHT + MIN_RESPONSE_HEIGHT
                        ? paneHeight - MIN_REQUEST_HEIGHT
                        : Math.floor(window.innerHeight * 0.7)
                    responseResizeOrigin.current = {
                      height: responseHeight,
                      maximumHeight,
                      y: event.clientY,
                    }
                    setIsResizingResponse(true)
                  }}
                  className={`h-1 shrink-0 cursor-ns-resize transition-colors motion-reduce:transition-none ${
                    isResizingResponse ? 'bg-i3x-primary' : 'bg-i3x-border hover:bg-i3x-primary/50'
                  }`}
                />
                <section
                  className="flex shrink-0 flex-col overflow-hidden"
                  style={{ height: `${responseHeight}px` }}
                >
                <div className="flex items-center gap-2 border-b border-i3x-border bg-i3x-surface px-3 py-1.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-i3x-text-muted">
                    Response
                  </h3>
                  {isExecuting && (
                    <span className="flex items-center gap-1.5 text-[11px] text-i3x-text-muted">
                      <Spinner size={11} /> Waiting for server...
                    </span>
                  )}
                  {response && (
                    <span className={`font-mono text-[11px] font-semibold ${response.status < 400 ? 'text-i3x-success' : 'text-i3x-warning'}`}>
                      {response.status} {response.statusText}
                    </span>
                  )}
                  <CopyButton
                    text={response?.body ?? executionError ?? ''}
                    className="ml-auto"
                    title="Copy response"
                  />
                </div>
                <pre className="min-h-0 flex-1 overflow-auto bg-i3x-bg px-4 py-3 font-mono text-[12.5px] leading-relaxed text-i3x-text">
                  <code>{response ? formatResponseBody(response.body) : executionError ?? 'Request is in progress.'}</code>
                </pre>
                </section>
              </>
            )}
          </div>
        </div>

        {/* Footer copy actions */}
        <footer className="flex flex-wrap items-center gap-2 border-t border-i3x-border px-4 py-2.5">
          <FooterCopy text={snippet} label="Copy request" />
          {bodyJson && <FooterCopy text={bodyJson} label="Copy body" />}
          <FooterCopy text={url} label="Copy URL" />
        </footer>
      </div>
    </div>
  )
}

function MetaField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="mb-1 text-[11px] uppercase tracking-wide text-i3x-text-muted">{label}</dt>
      <dd
        className={`break-words text-[12px] text-i3x-text ${mono ? 'whitespace-pre-wrap font-mono' : ''}`}
      >
        {value.split('\n').map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {line}
          </Fragment>
        ))}
      </dd>
    </div>
  )
}

function FooterCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* insecure context / denied — fail quietly */
        }
      }}
      className="rounded-lg border border-i3x-border bg-i3x-bg px-3 py-1.5 text-xs font-medium text-i3x-text-muted hover:text-i3x-text hover:border-i3x-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
    >
      {copied ? 'Copied!' : label}
    </button>
  )
}
