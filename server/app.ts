import { Hono } from 'hono'
import { auth, requireAuth } from './auth'
import { images } from './routes/images'
import { ai } from './routes/ai'

export type Env = { DB: D1Database; BUCKET: R2Bucket; JWT_SECRET: string; GEMINI_API_KEY?: string }

export const createApp = () => {
  const api = new Hono<{ Bindings: Env }>()
  api.route('/auth', auth) // login is public; /me and /logout are guarded inside
  api.use('*', requireAuth) // everything below is private
  api.route('/images', images)
  api.route('/ai', ai)
  return new Hono<{ Bindings: Env }>().route('/api', api)
}
