import fs from 'fs'
import path from 'path'
import { loadEnv, type Connect, type Plugin } from 'vite'
import { mergeRuntimeConfig } from './electron/runtimeConfig'

// Names this plugin set from .env files. Vite restarts in-process on a .env edit and re-imports
// this module, so the set lives on globalThis to survive it; only these names are refreshed.
const processState = globalThis as typeof globalThis & { __i3xEnvFileVars?: Set<string> }
const fromEnvFiles = (processState.__i3xEnvFileVars ??= new Set<string>())

/**
 * Local stand-in for a deployment's config.json: loads I3X_OAUTH_* variables from
 * .env files (the real environment wins) and serves config.json built from them.
 * The Electron main process inherits them through process.env.
 */
export function runtimeConfigFromEnv(): Plugin {
  let base = '/'
  let root = process.cwd()

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split('?')[0] !== `${base}config.json`) return next()
    const file = path.join(root, 'public', 'config.json')
    let site: unknown = {}
    try {
      if (fs.existsSync(file)) site = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      console.warn(`[config] Ignoring ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(mergeRuntimeConfig(site, process.env)))
  }

  return {
    name: 'i3x-runtime-config-from-env',
    apply: 'serve',
    config(_config, { mode }) {
      fromEnvFiles.forEach(name => delete process.env[name])
      fromEnvFiles.clear()
      for (const [name, value] of Object.entries(loadEnv(mode, process.cwd(), 'I3X_OAUTH_'))) {
        if (process.env[name] !== undefined) continue
        process.env[name] = value
        fromEnvFiles.add(name)
      }
    },
    configResolved(config) {
      base = config.base
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
