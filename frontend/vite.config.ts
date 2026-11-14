import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'

// The site is served from https://evge14n.github.io/spaceu-lunar-navigator/ on GitHub Pages.
// Override with VITE_BASE=/ for other hosts.
const base = process.env.VITE_BASE ?? '/spaceu-lunar-navigator/'
const repoData = resolve(import.meta.dirname, '../data')

/** List of files in ../data, so the site never probes for missing files (no 404s in the console). */
function manifest(): string {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name)
      if (e.isDirectory()) walk(f)
      else files.push(relative(repoData, f).replace(/\\/g, '/'))
    }
  }
  if (existsSync(repoData)) walk(repoData)
  return JSON.stringify({ files: files.sort() })
}

/** Serve ../data at <base>data/ in dev and copy it into dist/data on build, exactly like Pages. */
function repoDataPlugin(): Plugin {
  return {
    name: 'repo-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0])
        if (url === `${base}data-manifest.json`) {
          res.setHeader('Content-Type', 'application/json')
          return res.end(manifest())
        }
        const prefix = `${base}data/`
        if (!url.startsWith(prefix)) return next()
        const file = join(repoData, url.slice(prefix.length))
        if (!file.startsWith(repoData) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404
          return res.end('not found')
        }
        if (file.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (existsSync(repoData)) cpSync(repoData, resolve(import.meta.dirname, 'dist/data'), { recursive: true })
      writeFileSync(resolve(import.meta.dirname, 'dist/data-manifest.json'), manifest())
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), repoDataPlugin()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
  },
})
