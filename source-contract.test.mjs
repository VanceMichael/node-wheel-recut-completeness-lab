import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSources } from './source-server.mjs'

const wire = JSON.parse(await readFile(new URL('./wire.json', import.meta.url), 'utf8'))
const key = route => JSON.stringify([route.method, route.path, route.params ?? {}, route.expectedBody ?? {}])

for (const phase of wire.phases) test(phase + ' 时点原件及来源回执', async t => {
  const server = createSources().listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = `http://127.0.0.1:${server.address().port}`
  const json = { 'content-type': 'application/json' }
  let id = 0
  {
    const set = await fetch(address + '/_source/phase', { method: 'PUT', headers: json, body: JSON.stringify({phase}) })
    assert.equal(set.status, 200)
    const dispatched = new Set()
    const used = new Map()
    for (const route of wire.routes) {
      if (route.phase && route.phase !== phase) continue
      const k = key(route)
      if (dispatched.has(k)) continue
      if (!route.once) dispatched.add(k)
      const query = new URLSearchParams(route.params)
      const body = { ...route.expectedBody, requestId: 'wire-' + ++id }
      const options = route.method === 'GET' ? {} : { method: route.method, headers: json, body: JSON.stringify(body) }
      const send = () => fetch(address + route.path + '?' + query, options)
      if (route.useLimit) {
        const { group, cap } = route.useLimit
        const count = used.get(group) ?? 0
        if (count >= cap) {
          assert.equal((await send()).status, 429)
          continue
        }
        used.set(group, count + 1)
      }
      if (route.drop) await assert.rejects(send())
      else {
        const response = await send()
        assert.equal(response.status, route.status, `${phase}: ${k}`)
        if (route.file) {
          assert.equal(response.headers.get('content-type'), route.mime)
          const received = Buffer.from(await response.arrayBuffer())
          const file = await readFile(new URL('./materials/' + encodeURIComponent(route.file), import.meta.url))
          assert.deepEqual(received, file)
          assert.ok(received.length)
        } else if (route.receipt) {
          assert.equal((await response.json()).requestId, body.requestId)
        } else {
          assert.deepEqual(await response.json(), route.data)
        }
      }
      if (route.receipt) {
        const receipt = await fetch(address + '/receipts?requestId=' + body.requestId)
        assert.equal(receipt.status, 200)
        const data = await receipt.json()
        assert.deepEqual(data.submitted, body)
        for (const [field, value] of Object.entries(route.receipt)) assert.deepEqual(data[field], value)
      }
    }
  }
  const unused = await fetch(address + '/receipts?requestId=not-present')
  assert.equal(unused.status, 404)
})
