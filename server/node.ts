import { serve } from '@hono/node-server'
import { getPlatformProxy } from 'wrangler'
import { createApp } from './app'

// local D1/R2 (miniflare) + .dev.vars via wrangler, same app as the Worker
const { env } = await getPlatformProxy()
const app = createApp()
serve({ port: 8787, fetch: (req) => app.fetch(req, env) }, () => console.log('api on :8787'))
