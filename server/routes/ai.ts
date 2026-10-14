import { Hono } from 'hono'
import type { Env } from '../app'

// PDF-capable models; check https://aistudio.google.com/docs/deprecations before relying on these.
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview']

export const ai = new Hono<{ Bindings: Env }>().post('/generate', async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'GEMINI_API_KEY not set' }, 500)
  const body = await c.req.json() // Gemini generateContent payload (supports inline_data application/pdf)
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': c.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  })
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } })
})
