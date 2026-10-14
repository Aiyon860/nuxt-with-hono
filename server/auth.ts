import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { createMiddleware } from 'hono/factory'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { users } from './db/schema'
import type { Env } from './app'

const COOKIE = 'token'
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256))
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${hex(salt)}:${await pbkdf2(password, salt)}`
}

async function checkPassword(password: string, stored: string) {
  const [saltHex, h] = stored.split(':')
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (x) => parseInt(x, 16))
  return (await pbkdf2(password, salt)) === h
}

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: { user: string } }>(async (c, next) => {
  const token = getCookie(c, COOKIE)
  if (!token) return c.json({ error: 'unauthorized' }, 401)
  try {
    c.set('user', (await verify(token, c.env.JWT_SECRET, 'HS256')).sub as string)
  } catch {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

export const auth = new Hono<{ Bindings: Env; Variables: { user: string } }>()
  .post('/login', async (c) => {
    const { username, password } = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}) as any)
    if (!username || !password) return c.json({ error: 'bad request' }, 400)
    const [u] = await drizzle(c.env.DB).select().from(users).where(eq(users.username, username))
    if (!u || !(await checkPassword(password, u.passwordHash))) return c.json({ error: 'invalid credentials' }, 401)
    const token = await sign({ sub: u.username, exp: Math.floor(Date.now() / 1000) + 7 * 86400 }, c.env.JWT_SECRET)
    setCookie(c, COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: 7 * 86400 })
    return c.json({ user: u.username })
  })
  .post('/logout', requireAuth, (c) => (deleteCookie(c, COOKIE, { path: '/' }), c.json({ ok: true })))
  .get('/me', requireAuth, (c) => c.json({ user: c.get('user') }))
