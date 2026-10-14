import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { images as imagesTable } from '../db/schema'
import type { Env } from '../app'

export const images = new Hono<{ Bindings: Env }>()
  .put('/', async (c) => {
    const type = c.req.header('content-type') ?? ''
    if (!type.startsWith('image/')) return c.json({ error: 'image/* required' }, 415)
    const key = crypto.randomUUID()
    await c.env.BUCKET.put(key, c.req.raw.body, { httpMetadata: { contentType: type } })
    await drizzle(c.env.DB).insert(imagesTable).values({ key, contentType: type })
    return c.json({ key }, 201)
  })
  .get('/:key', async (c) => {
    const obj = await c.env.BUCKET.get(c.req.param('key'))
    if (!obj) return c.json({ error: 'not found' }, 404)
    return new Response(obj.body as ReadableStream, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' } })
  })
