import { useId, useState, type ReactNode } from 'react'
import { useConnectionStore } from '../../stores/connection'
import type { Credentials } from '../../stores/connection'
import { oauthSettingsFor, performConnect, performDisconnect } from '../../services/connection'
import { configuredServers, getRuntimeConfig, oauthProfilesFor, type ConfiguredServer, type OAuthProfile } from '../../config/runtimeConfig'
import type { OAuthSettings } from '../../auth/oauthProtocol'
import { defaultTransport, hasOAuthSession, signOutOAuth } from '../../auth/oauthSession'
import { CloseIcon, LockIcon, WarningIcon } from '../common/icons'

const prepareSignIn = () => defaultTransport().prepareSignIn()

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

type AuthMethod = 'none' | 'basic' | 'bearer' | 'header' | 'oauth'

const normalizeUrl = (url: string) => url.replace(/\/+$/, '')

const profilesFor = (url: string) => oauthProfilesFor(getRuntimeConfig().oauthProfiles, url)

const profileName = (profile: OAuthProfile) => profile.label ?? profile.name

/** "i3X demo server", "Company account", or both, with a lock when a sign-in profile applies. */
function serverDetail(server: ConfiguredServer): ReactNode {
  const text = [server.label, server.profiles.map(profileName).join(', ')].filter(Boolean).join(' · ')
  if (!text) return undefined
  return <>{server.profiles.length > 0 && <LockIcon size={11} />}{text}</>
}

const splitList = (value: string) => value.split(/[\s,]+/).filter(Boolean)

const inputClass =
  'w-full px-3 py-2 text-sm bg-i3x-bg rounded border border-i3x-border focus:border-i3x-primary focus:outline-none'

const labelClass = 'block text-xs text-i3x-text-muted mb-1'

const smallButtonClass =
  'px-2 py-0.5 rounded border border-i3x-border text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors'

const isHttpUrl = (url: string) => {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const CREDENTIAL_LABELS: Record<Credentials['type'], string> = {
  basic: 'Basic auth',
  bearer: 'Bearer token',
  header: 'Custom header',
  oauth: 'OAuth sign-in',
}

function ServerRow({ url, detail, selected, onSelect, onRemove }: {
  url: string
  detail?: ReactNode
  selected: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  return (
    <li className={`group flex items-center rounded transition-colors ${selected ? 'bg-i3x-primary/15' : 'hover:bg-i3x-bg'}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        title={url}
        className="flex-1 min-w-0 text-left px-3 py-1.5"
      >
        <span className={`block truncate text-sm ${selected ? 'text-i3x-primary' : 'text-i3x-text'}`}>{url}</span>
        {detail && <span className="flex items-center gap-1 text-[11px] text-i3x-text-muted">{detail}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${url} from recent connections`}
          title="Remove, and forget its saved sign-in"
          className="p-1.5 mr-1 rounded text-i3x-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-i3x-text"
        >
          <CloseIcon size={12} />
        </button>
      )}
    </li>
  )
}

export function ConnectionDialog() {
  const {
    serverUrl,
    credentials: activeCredentials,
    accountName,
    isConnected,
    recentUrls,
    ignoreCertErrors: storedIgnoreCertErrors,
    setServerUrl,
    setServerUrlUserSet,
    setCredentials,
    saveCredentialsForUrl,
    getCredentialsForUrl,
    removeRecentUrl,
    setIgnoreCertErrors,
    setShowConnectionDialog
  } = useConnectionStore()

  // Initialize with saved credentials for current server
  const savedCreds = getCredentialsForUrl(serverUrl)

  function getInitialAuthMethod(): AuthMethod {
    if (!savedCreds) return profilesFor(serverUrl).length > 0 ? 'oauth' : 'none'

    return savedCreds.type;
  }

  const savedOAuth = savedCreds?.type === 'oauth' ? savedCreds.settings : undefined

  const [inputUrl, setInputUrl] = useState(serverUrl)
  const [ignoreCertErrors, setLocalIgnoreCertErrors] = useState(storedIgnoreCertErrors)
  const [authMethod, setAuthMethod] = useState<AuthMethod>(getInitialAuthMethod())
  const [username, setUsername] = useState(savedCreds?.type === 'basic' ? savedCreds.username : '')
  const [password, setPassword] = useState(savedCreds?.type === 'basic' ? savedCreds.password : '')
  const [token, setToken] = useState(savedCreds?.type === 'bearer' ? savedCreds.token : '')
  const [headerName, setHeaderName] = useState(savedCreds?.type === 'header' ? savedCreds.headerName : '')
  const [headerValue, setHeaderValue] = useState(savedCreds?.type === 'header' ? savedCreds.headerValue : '')
  const [customOAuth, setCustomOAuth] = useState(!!savedOAuth)
  const [oauthProfile, setOAuthProfile] = useState(savedCreds?.type === 'oauth' ? savedCreds.profile : undefined)
  const [oauthIssuer, setOAuthIssuer] = useState(savedOAuth?.issuer ?? '')
  const [oauthClientId, setOAuthClientId] = useState(savedOAuth?.clientId ?? '')
  const [oauthScopes, setOAuthScopes] = useState(savedOAuth?.scopes.join(' ') ?? '')
  const [oauthResource, setOAuthResource] = useState(savedOAuth?.resource ?? '')
  const [oauthExtraParams, setOAuthExtraParams] = useState(new URLSearchParams(savedOAuth?.extraParams ?? {}).toString())
  const [oauthRedirectUri, setOAuthRedirectUri] = useState(savedOAuth?.redirectUri ?? '')
  const [oauthLoopbackRedirectUri, setOAuthLoopbackRedirectUri] = useState(savedOAuth?.loopbackRedirectUri ?? '')
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null)
  const id = useId()

  const targetUrl = inputUrl.trim()
  const urlError = targetUrl && !isHttpUrl(targetUrl) ? 'Enter a full URL starting with http:// or https://.' : null

  // Read from the runtime configuration on every render and never saved, so they follow it.
  const configured = configuredServers(getRuntimeConfig())
  const configuredKeys = new Set(configured.map(server => normalizeUrl(server.url)))
  const otherRecentUrls = recentUrls.filter(url => !configuredKeys.has(normalizeUrl(url)))
  const isSelected = (url: string) => normalizeUrl(url) === normalizeUrl(targetUrl)

  const oauthProfiles = profilesFor(targetUrl)
  // A named profile that no longer applies stays unresolved: substituting another could sign in to a different tenant.
  const profileMissing = !!oauthProfile && !oauthProfiles.some(profile => profile.name === oauthProfile)
  const selectedProfile = profileMissing
    ? undefined
    : oauthProfiles.find(profile => profile.name === oauthProfile) ?? oauthProfiles[0]
  const profileMode = authMethod === 'oauth' && !customOAuth && oauthProfiles.length > 0
  const usesProfile = profileMode && !!selectedProfile
  const oauthIncomplete = authMethod === 'oauth' && (profileMode
    ? !selectedProfile
    : !oauthIssuer.trim() || !oauthClientId.trim() || splitList(oauthScopes).length === 0)

  const fillOAuth = (settings: OAuthSettings | null | undefined) => {
    setOAuthIssuer(settings?.issuer ?? '')
    setOAuthClientId(settings?.clientId ?? '')
    setOAuthScopes(settings?.scopes.join(' ') ?? '')
    setOAuthResource(settings?.resource ?? '')
    setOAuthExtraParams(new URLSearchParams(settings?.extraParams ?? {}).toString())
    setOAuthRedirectUri(settings?.redirectUri ?? '')
    setOAuthLoopbackRedirectUri(settings?.loopbackRedirectUri ?? '')
  }

  const buildCredentials = (): Credentials | null => {
    if (authMethod === 'oauth') {
      // Saved by name: a profile added later must never move this connection to another issuer or tenant.
      if (usesProfile && selectedProfile) return { type: 'oauth', profile: selectedProfile.name }
      if (oauthIncomplete) return null
      const extraParams = Object.fromEntries(new URLSearchParams(oauthExtraParams.trim()))
      return {
        type: 'oauth',
        settings: {
          issuer: oauthIssuer.trim(),
          clientId: oauthClientId.trim(),
          scopes: splitList(oauthScopes),
          ...(oauthResource.trim() ? { resource: oauthResource.trim() } : {}),
          ...(Object.keys(extraParams).length > 0 ? { extraParams } : {}),
          ...(oauthRedirectUri.trim() ? { redirectUri: oauthRedirectUri.trim() } : {}),
          ...(oauthLoopbackRedirectUri.trim() ? { loopbackRedirectUri: oauthLoopbackRedirectUri.trim() } : {}),
        },
      }
    }
    if (authMethod === 'basic' && username) {
      return { type: 'basic', username, password }
    }
    if (authMethod === 'bearer' && token) {
      return { type: 'bearer', token }
    }
    if (authMethod === 'header' && headerName && headerValue) {
      return { type: 'header', headerName: headerName.trim(), headerValue }
    }
    return null
  }

  // The live client captured its URL and credentials at construction, so a
  // Save that changes either while connected must reconnect, otherwise the
  // status bar shows the new server while requests keep hitting the old one.
  // (ignoreCertErrors applies live via IPC and never needs a reconnect.)
  const changesConnection = (newCredentials: Credentials | null) =>
    isConnected &&
    (normalizeUrl(targetUrl) !== normalizeUrl(serverUrl) ||
      JSON.stringify(newCredentials) !== JSON.stringify(activeCredentials))

  const canSave = !!targetUrl && !urlError && !oauthIncomplete

  const handleSave = async (connect: boolean) => {
    if (!canSave) return
    const newCredentials = buildCredentials()
    const reconnect = changesConnection(newCredentials)
    const startsConnection = reconnect || (connect && !isConnected)
    // Before any await, so a browser still counts the click as the gesture that opened the window.
    const newSettings = startsConnection ? oauthSettingsFor(newCredentials, targetUrl) : null
    if (newSettings && !hasOAuthSession(newSettings)) prepareSignIn()

    setServerUrl(targetUrl)
    // Saving the dialog is the explicit user choice; from now on a ?server=
    // deep link must not override it.
    setServerUrlUserSet(true)
    setCredentials(newCredentials)
    saveCredentialsForUrl(targetUrl, newCredentials)
    setIgnoreCertErrors(ignoreCertErrors)
    window.electronAPI?.setIgnoreCertErrors(ignoreCertErrors)
    setShowConnectionDialog(false)

    if (reconnect) {
      await performDisconnect()
      await performConnect()
    } else if (startsConnection) {
      await performConnect()
    }
  }

  const handleCancel = () => {
    setShowConnectionDialog(false)
  }

  const handleSelectServer = (url: string) => {
    setInputUrl(url)
    const creds = getCredentialsForUrl(url)
    setUsername(creds?.type === 'basic' ? creds.username : '')
    setPassword(creds?.type === 'basic' ? creds.password : '')
    setToken(creds?.type === 'bearer' ? creds.token : '')
    setHeaderName(creds?.type === 'header' ? creds.headerName : '')
    setHeaderValue(creds?.type === 'header' ? creds.headerValue : '')
    const oauth = creds?.type === 'oauth' ? creds : undefined
    setCustomOAuth(!!oauth?.settings)
    setOAuthProfile(oauth?.profile)
    fillOAuth(oauth?.settings)
    setAuthMethod(creds?.type ?? (profilesFor(url).length > 0 ? 'oauth' : 'none'))
  }

  // Sign-out applies to whatever sign-in this server's OAuth settings resolve to, saved or default.
  const signOutSettings = authMethod === 'oauth' ? oauthSettingsFor(buildCredentials(), targetUrl) : null
  const canSignOut = !!signOutSettings && hasOAuthSession(signOutSettings)
  const isActiveSignIn = isConnected && activeCredentials?.type === 'oauth' && normalizeUrl(serverUrl) === normalizeUrl(targetUrl)
  const signInStatus = !signOutSettings
    ? null
    : canSignOut
      ? (isActiveSignIn && accountName ? `Signed in as ${accountName}` : 'Signed in')
      : 'You will be asked to sign in when you connect.'

  const primaryLabel = !isConnected
    ? 'Save & Connect'
    : changesConnection(buildCredentials()) ? 'Save & Reconnect' : 'Save'

  const handleSignOut = async (endSession: boolean) => {
    if (!signOutSettings) return
    setSignOutNotice(null)
    if (isActiveSignIn) {
      await performDisconnect()
    }
    try {
      const result = await signOutOAuth(signOutSettings, { endSession })
      setSignOutNotice(result.revoked
        ? 'Signed out; the issuer has revoked the sign-in.'
        : 'Signed out of i3X Explorer. This issuer offers no revocation; its tokens expire on their own.')
    } catch (err) {
      setSignOutNotice(`Signed out of i3X Explorer, but the issuer could not be reached: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onSubmit={(e) => {
          e.preventDefault()
          void handleSave(true)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          handleCancel()
        }}
        className="bg-i3x-surface rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col border border-i3x-border"
      >
        <div className="px-4 py-3 border-b border-i3x-border flex items-center justify-between">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-i3x-text">Server Connection</h2>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close"
            className="p-1 rounded text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg transition-colors"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label htmlFor={`${id}-url`} className={labelClass}>Server URL</label>
            <input
              id={`${id}-url`}
              type="text"
              inputMode="url"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="https://i3x.example.com"
              aria-invalid={!!urlError}
              aria-describedby={urlError ? `${id}-url-error` : undefined}
              className={inputClass}
              autoFocus
            />
            {urlError && <p id={`${id}-url-error`} className="mt-1 text-xs text-i3x-error">{urlError}</p>}

            {(configured.length > 0 || otherRecentUrls.length > 0) && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded border border-i3x-border py-1">
                {configured.length > 0 && (
                  <>
                    <p id={`${id}-configured`} className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-i3x-text-muted">
                      Configured
                    </p>
                    <ul aria-labelledby={`${id}-configured`} className="px-1">
                      {configured.map((server) => (
                        <ServerRow
                          key={server.url}
                          url={server.url}
                          selected={isSelected(server.url)}
                          onSelect={() => handleSelectServer(server.url)}
                          detail={serverDetail(server)}
                        />
                      ))}
                    </ul>
                  </>
                )}
                {otherRecentUrls.length > 0 && (
                  <>
                    <p id={`${id}-recent`} className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-i3x-text-muted">
                      Recent
                    </p>
                    <ul aria-labelledby={`${id}-recent`} className="px-1">
                      {otherRecentUrls.map((url) => {
                        const saved = getCredentialsForUrl(url)
                        return (
                          <ServerRow
                            key={url}
                            url={url}
                            selected={isSelected(url)}
                            onSelect={() => handleSelectServer(url)}
                            onRemove={() => removeRecentUrl(url)}
                            detail={saved && <><LockIcon size={11} />{CREDENTIAL_LABELS[saved.type]}</>}
                          />
                        )
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-auth`} className={labelClass}>Authentication</label>
            <select
              id={`${id}-auth`}
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}
              className={inputClass}
            >
              <option value="none">None</option>
              <option value="basic">Basic Auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="header">Custom Header</option>
              <option value="oauth">OAuth 2.0 sign-in</option>
            </select>
          </div>

          {authMethod === 'oauth' && (
            <div className="space-y-3 rounded border border-i3x-border p-3">
              {signInStatus && (
                <div className="space-y-2 text-xs">
                  <span className={`flex items-center gap-1.5 ${canSignOut ? 'text-i3x-text' : 'text-i3x-text-muted'}`}>
                    <LockIcon size={12} className={canSignOut ? 'text-i3x-success' : undefined} />
                    {signInStatus}
                  </span>
                  {canSignOut && (
                    <span className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void handleSignOut(false)} className={smallButtonClass}>
                        Sign out
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSignOut(true)}
                        title="Also ends your session at the identity provider in this browser, which signs you out of its other apps too"
                        className={smallButtonClass}
                      >
                        Sign out of {new URL(signOutSettings.issuer).host} too
                      </button>
                    </span>
                  )}
                </div>
              )}
              {signOutNotice && <p className="text-xs text-i3x-text-muted" role="status">{signOutNotice}</p>}
              {profileMissing && (
                <p role="alert" className="flex gap-1.5 text-xs text-i3x-warning">
                  <WarningIcon size={13} className="mt-px" />
                  <span>
                    The saved sign-in profile &ldquo;{oauthProfile}&rdquo; is no longer configured for this server.
                    {oauthProfiles.length > 0 ? ' Choose a profile.' : ' Enter sign-in settings.'}
                  </span>
                </p>
              )}
              {profileMode ? (
                <div className="text-xs text-i3x-text-muted space-y-2">
                  {oauthProfiles.length > 1 || !selectedProfile ? (
                    <div>
                      <label htmlFor={`${id}-profile`} className="block mb-1">Sign-in profile</label>
                      <select
                        id={`${id}-profile`}
                        value={selectedProfile?.name ?? ''}
                        onChange={(e) => setOAuthProfile(e.target.value)}
                        className={inputClass}
                      >
                        {!selectedProfile && <option value="" disabled>Choose a profile&hellip;</option>}
                        {oauthProfiles.map(profile => (
                          <option key={profile.name} value={profile.name}>
                            {profileName(profile)} ({new URL(profile.issuer).host})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p>
                      Signs in with <span className="text-i3x-text">{profileName(selectedProfile)}</span>,
                      configured for this server.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      fillOAuth(selectedProfile)
                      setCustomOAuth(true)
                    }}
                    className="text-i3x-primary hover:underline"
                  >
                    Use custom settings
                  </button>
                </div>
              ) : (
                <>
                  {oauthProfiles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomOAuth(false)}
                      className="text-xs text-i3x-primary hover:underline"
                    >
                      Use a profile configured for this server
                    </button>
                  )}
                  <div>
                    <label htmlFor={`${id}-issuer`} className={labelClass}>Issuer</label>
                    <input
                      id={`${id}-issuer`}
                      type="url"
                      value={oauthIssuer}
                      onChange={(e) => setOAuthIssuer(e.target.value)}
                      placeholder="https://login.example.com/tenant/v2.0"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${id}-client`} className={labelClass}>Client ID</label>
                    <input
                      id={`${id}-client`}
                      type="text"
                      value={oauthClientId}
                      onChange={(e) => setOAuthClientId(e.target.value)}
                      placeholder="the explorer's app registration"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${id}-scopes`} className={labelClass}>Scopes</label>
                    <input
                      id={`${id}-scopes`}
                      type="text"
                      value={oauthScopes}
                      onChange={(e) => setOAuthScopes(e.target.value)}
                      placeholder="openid profile offline_access api://i3x/read"
                      className={inputClass}
                    />
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-i3x-text-muted">Advanced</summary>
                    <div className="space-y-3 mt-2">
                      <div>
                        <label htmlFor={`${id}-resource`} className={labelClass}>Resource (optional)</label>
                        <input
                          id={`${id}-resource`}
                          type="text"
                          value={oauthResource}
                          onChange={(e) => setOAuthResource(e.target.value)}
                          placeholder="https://i3x.example.com"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label htmlFor={`${id}-extra`} className={labelClass}>Extra sign-in parameters (optional)</label>
                        <input
                          id={`${id}-extra`}
                          type="text"
                          value={oauthExtraParams}
                          onChange={(e) => setOAuthExtraParams(e.target.value)}
                          placeholder="prompt=select_account"
                          className={inputClass}
                        />
                      </div>
                      {isElectron ? (
                        <div>
                          <label htmlFor={`${id}-loopback`} className={labelClass}>Loopback redirect URI (optional)</label>
                          <input
                            id={`${id}-loopback`}
                            type="url"
                            value={oauthLoopbackRedirectUri}
                            onChange={(e) => setOAuthLoopbackRedirectUri(e.target.value)}
                            placeholder="http://localhost/ (any port unless one is given)"
                            className={inputClass}
                          />
                        </div>
                      ) : (
                        <div>
                          <label htmlFor={`${id}-redirect`} className={labelClass}>Redirect URI (optional)</label>
                          <input
                            id={`${id}-redirect`}
                            type="url"
                            value={oauthRedirectUri}
                            onChange={(e) => setOAuthRedirectUri(e.target.value)}
                            placeholder="defaults to this site's oauth/callback.html"
                            className={inputClass}
                          />
                        </div>
                      )}
                    </div>
                  </details>
                </>
              )}
            </div>
          )}

          {authMethod === 'basic' && (
            <div className="space-y-3">
              <div>
                <label htmlFor={`${id}-username`} className={labelClass}>Username</label>
                <input
                  id={`${id}-username`}
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`${id}-password`} className={labelClass}>Password</label>
                <input
                  id={`${id}-password`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {authMethod === 'bearer' && (
            <div>
              <label htmlFor={`${id}-token`} className={labelClass}>Token</label>
              <input
                id={`${id}-token`}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="paste your bearer token"
                className={inputClass}
              />
            </div>
          )}

          {authMethod === 'header' && (
            <div className="space-y-3">
              <div>
                <label htmlFor={`${id}-header-name`} className={labelClass}>Header Name</label>
                <input
                  id={`${id}-header-name`}
                  type="text"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  placeholder="header name (e.g. X-API-Key, x-auth-token, Ocp-Apim-Subscription-Key)"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={`${id}-header-value`} className={labelClass}>Header Value</label>
                <input
                  id={`${id}-header-value`}
                  type="password"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  placeholder="header value"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {isElectron && (
            <div className="flex items-center gap-2">
              <input
                id={`${id}-ignore-cert`}
                type="checkbox"
                checked={ignoreCertErrors}
                onChange={(e) => setLocalIgnoreCertErrors(e.target.checked)}
                className="w-3.5 h-3.5 accent-i3x-primary cursor-pointer"
              />
              <label htmlFor={`${id}-ignore-cert`} className="text-xs text-i3x-text-muted cursor-pointer select-none">
                Ignore certificate errors (eg: self-signed)
              </label>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-i3x-border flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-1.5 text-sm text-i3x-text-muted hover:text-i3x-text transition-colors"
          >
            Cancel
          </button>
          {!isConnected && (
            <button
              type="button"
              onClick={() => void handleSave(false)}
              disabled={!canSave}
              className="px-4 py-1.5 text-sm rounded border border-i3x-border text-i3x-text hover:bg-i3x-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          )}
          <button
            type="submit"
            disabled={!canSave}
            className="px-4 py-1.5 text-sm bg-i3x-primary text-white rounded hover:bg-i3x-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {primaryLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
