import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const exchange = JSON.parse(await readFile(new URL('./wire.json', import.meta.url), 'utf8'))
const has = (actual, expected = {}) => Object.entries(expected).every(([name, value]) => actual?.[name] === value)
const toText = value => value === undefined ? '' : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
const h = value => toText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

function send(res, code, value, mime = 'application/json', headers = {}) {
  res.writeHead(code, { 'Content-Type': mime, ...headers })
  res.end(mime === 'application/json' ? JSON.stringify(value) : value)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 128 * 1024) throw new Error('录入过长')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  if ((req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text))
  }
  return JSON.parse(text)
}

function formMarkup(form, data, params, result) {
  const header = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${h(form.title)}</title><h1>${h(form.title)}</h1>`
  const query = form.query.map(([key, label, options]) => {
    if (options === null) return `<label for="query-${h(key)}">${h(label)}</label> <input id="query-${h(key)}" name="${h(key)}" value="${h(params[key])}" required>`
    const values = options.map(([id, name]) => `<option value="${h(id)}"${params[key] === id ? ' selected' : ''}>${h(name)}</option>`)
    return `<label for="query-${h(key)}">${h(label)}</label> <select id="query-${h(key)}" name="${h(key)}">${values.join('')}</select>`
  }).join(' ')
  const columns = form.columns.map(key => `<th scope="col">${h(key)}</th>`).join('')
  const rows = data.map(row => `<tr>${form.columns.map(key => `<td>${h(row[key])}</td>`).join('')}</tr>`).join('')
  const fields = form.fields.map(([key, label]) => `<label for="action-${h(key)}">${h(label)}</label> <input id="action-${h(key)}" name="${h(key)}" value="${h(params[key])}" required>`).join(' ')
  const entry = form.action ? `<form method="post">${fields} <button>提交办理</button></form>` : ''
  const receipt = result ? `<p role="status">${h(result)}</p>` : ''
  return header + `<form method="get">${query} <button>查询来源</button></form>`
    + `<table><caption>当前来源记录</caption><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table>${entry}${receipt}</html>`
}

export function createSources() {
  let phase = 'first'
  const useCount = new Map()
  const receipts = new Map()
  const allocated = new Map()
  const observed = []
  function select(method, path, params, body) {
    const matches = exchange.routes.filter(route =>
      route.method === method && route.path === path &&
      (!route.phase || route.phase === phase) && has(params, route.params) && has(body, route.expectedBody))
    return matches.find(route => !route.once || !useCount.has(route))
  }
  async function endpoint(method, path, params, body) {
    const route = select(method, path, params, body)
    if (!route) return { status: 404, data: { notice: '来源没有对应记录' } }
    if (route.useLimit) {
      const { group, cap } = route.useLimit
      const used = allocated.get(group) ?? 0
      if (used >= cap) return { status: 429, data: { notice: '本相机日额度已用完' } }
      allocated.set(group, used + 1)
    }
    if (route.once) useCount.set(route, true)
    if (route.file) {
      const name = basename(route.file)
      return { ...route, data: await readFile(new URL('./materials/' + encodeURIComponent(name), import.meta.url)) }
    }
    if (route.receipt) {
      if (!body?.requestId) return { status: 422, data: { notice: '缺少办理号' } }
      const key = String(body.requestId)
      const previous = receipts.get(key)
      if (previous) {
        if (previous.path === path && JSON.stringify(previous.submitted) === JSON.stringify(body)) {
          return { status: 200, data: previous }
        }
        return { status: 409, data: { notice: '同一办理号已用于另一请求' } }
      }
      const data = { requestId: key, path, submitted: body, ...route.receipt }
      receipts.set(key, data)
      return { ...route, data }
    }
    return route
  }
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const params = Object.fromEntries(url.searchParams)
    try {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {}
      if (req.method === 'PUT' && url.pathname === '/_source/phase') {
        if (!exchange.phases.includes(body.phase)) return send(res, 422, { notice: '未知来源时点' })
        phase = body.phase
        return send(res, 200, { phase })
      }
      if (req.method === 'GET' && url.pathname === '/receipts') {
        const receipt = receipts.get(params.requestId)
        return send(res, receipt ? 200 : 404, receipt ?? { notice: '尚无对应回执' })
      }
      if (req.method === 'GET' && url.pathname === '/_source/requests') return send(res, 200, observed)
      const form = url.pathname.match(/^\/portal\/(\d+)$/)
      if (form) {
        const definition = exchange.forms?.[Number(form[1]) - 1]
        if (!definition) return send(res, 404, '未知网页', 'text/plain; charset=utf-8')
        if (req.method === 'POST' && !definition.action) return send(res, 405, { notice: '本页仅供查阅' })
        observed.push({ method: req.method, path: url.pathname, params, phase })
        const listing = Object.keys(params).length ? await endpoint('GET', definition.source, params, {}) : {}
        const operation = req.method === 'POST' ? await endpoint('POST', definition.action, params, body) : {}
        const status = operation.drop ? { notice: '暂时没有收到页面回显，可查询办理号' } : operation.data
        return send(res, 200, formMarkup(definition, Array.isArray(listing.data) ? listing.data : [], params, status), 'text/html; charset=utf-8')
      }
      observed.push({ method: req.method, path: url.pathname, params, phase })
      const response = await endpoint(req.method, url.pathname, params, body)
      if (response.drop) return res.destroy()
      send(res, response.status, response.data, response.mime, response.headers)
    } catch {
      if (!res.headersSent) send(res, 400, { notice: '请求无法读取' })
      else res.end()
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '8080')
  createSources().listen(port, '127.0.0.1', function () {
    console.log(`资料交换入口 http://127.0.0.1:${this.address().port}`)
  })
}
