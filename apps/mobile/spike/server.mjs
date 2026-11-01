// Phase 1 spike harness. Throwaway; not part of the app. Zero dependencies.
//
//   node spike/server.mjs
//
// - /signal   : tiny mailbox used as the signaling channel (stands in for the
//               `web_rtc_signals` table + Realtime)
// - /job      : the app polls this for work, /enqueue adds work (curl)
// - /result   : the app and the browser peer page report results here
// - /peer.html: the browser side of the interop test
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)
const OUT = process.env.SPIKE_OUT ?? path.join(here, "results.jsonl")

const mail = new Map() // `${room}:${to}` -> [{ n, msg }]
const waiters = new Map() // `${room}:${to}` -> [{ res, after, timer }]
const jobs = { ios: [], android: [] }
const results = []
const t0 = Date.now()
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(7)

function readBody(req) {
  return new Promise((resolve) => {
    let data = ""
    req.on("data", (c) => (data += c))
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(obj))
}

function flush(key) {
  const box = mail.get(key) ?? []
  const remaining = []
  for (const w of waiters.get(key) ?? []) {
    const msgs = box.filter((m) => m.n > w.after)
    if (msgs.length) {
      clearTimeout(w.timer)
      json(w.res, 200, { msgs })
    } else remaining.push(w)
  }
  waiters.set(key, remaining)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const p = url.pathname

  if (req.method === "GET" && p === "/peer.html") {
    res.writeHead(200, { "content-type": "text/html" })
    return res.end(fs.readFileSync(path.join(here, "peer.html")))
  }

  if (req.method === "POST" && p === "/signal") {
    const { room, to, msg } = await readBody(req)
    const key = `${room}:${to}`
    const box = mail.get(key) ?? []
    box.push({ n: box.length + 1, msg })
    mail.set(key, box)
    flush(key)
    return json(res, 200, { ok: true })
  }

  if (req.method === "GET" && p === "/signal") {
    const key = `${url.searchParams.get("room")}:${url.searchParams.get("to")}`
    const after = Number(url.searchParams.get("after") ?? 0)
    const msgs = (mail.get(key) ?? []).filter((m) => m.n > after)
    if (msgs.length) return json(res, 200, { msgs })
    const w = { res, after }
    w.timer = setTimeout(() => {
      waiters.set(
        key,
        (waiters.get(key) ?? []).filter((x) => x !== w),
      )
      json(res, 200, { msgs: [] })
    }, 20000)
    waiters.set(key, [...(waiters.get(key) ?? []), w])
    return
  }

  if (req.method === "GET" && p === "/job") {
    const platform = url.searchParams.get("platform")
    return json(res, 200, jobs[platform]?.shift() ?? {})
  }

  if (req.method === "POST" && p === "/enqueue") {
    const { platform, job } = await readBody(req)
    if (!jobs[platform]) return json(res, 400, { error: "platform must be ios|android" })
    jobs[platform].push(job)
    console.log(stamp(), "enqueued", platform, JSON.stringify(job))
    return json(res, 200, { ok: true, queued: jobs[platform].length })
  }

  if (req.method === "POST" && p === "/result") {
    const body = await readBody(req)
    results.push(body)
    fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...body }) + "\n")
    console.log(stamp(), "RESULT", JSON.stringify(body).slice(0, 600))
    return json(res, 200, { ok: true })
  }

  if (req.method === "POST" && p === "/log") {
    const { who, line } = await readBody(req)
    console.log(stamp(), `[${who}]`, line)
    return json(res, 200, { ok: true })
  }

  if (req.method === "GET" && p === "/results") return json(res, 200, results)
  if (req.method === "POST" && p === "/clear") {
    results.length = 0
    mail.clear()
    return json(res, 200, { ok: true })
  }
  if (req.method === "GET" && p === "/hello") {
    console.log(stamp(), "hello from", url.searchParams.get("who"))
    return json(res, 200, { ok: true })
  }

  json(res, 404, { error: "not found", path: p })
})

server.listen(PORT, () => console.log(stamp(), `spike server on http://localhost:${PORT}`))
