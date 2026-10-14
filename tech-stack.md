Tech Stack:

- Frontend: nuxt (ssr: false, serve static asset dari worker nya saja)
- Backend: hono (nodejs di lokal, cloudflare worker runtime ketika dihosting) jadi 1 deploy saja sudah include frontend dan backend nya (tidak ada CORS), zod
- Database: D1 (drizzle, sangat disupport di cloudflare dan compatible dengan sistem type-safe nya hono), gunakan `db.batch([...])` untuk multiple statement karena free tier nya hanya punya maksimum 50 query per invocation
- Object storage: R2. Mekanisme simpel nya image diupload melalui worker dan menyimpan R2 key image nya di D1 dan buat bucketnya tetap private sehingga untuk fetch image nya tetap melalui worker (dan autentikasinya) dengan menspesifikasikan key image nya
- Auth: pake jwt cookie di hono saja, jangan dibiarkan API nya terbuka, semuanya harus private
- Deployment dan migration: pake wrangler yang dipakai di github actions
- AI API: Google API Studio (check for deprecated model: https://aistudio.google.com/docs/deprecations) → Di bawah ini model-model nya sudah support input PDF (di bawah ini udah langsung string endpoint model nya):
    - `gemini-3.8-flash`
    - `gemini-3.6-flash`
    - `gemini-3-flash-preview`
