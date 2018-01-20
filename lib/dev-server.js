#!/usr/bin/env node

const { createInterface } = require('readline')
const { createReadStream, readFile, readFileSync } = require('fs')
const { createServer, STATUS_CODES } = require('http')
const { extname, join, resolve } = require('path')
const watchExec = require('@jamen/watch-exec')
const WebSocket = require('ws')
const mimeData = require('mime-db')

const argv = process.argv.slice(3)
const embed = readFileSync(join(__dirname, 'embed.js'), 'utf8')
const entry = resolve(process.argv[2] || process.cwd())
const { DEV_SERVER_ADDRESS = 'localhost', DEV_SERVER_PORT = 3000 } = process.env
const mimes = {}

const echo = (message, fn = console.log) =>
  fn(new Date().toTimeString() + ' ' + message)

for (let mimeName in mimeData) {
  let mime = mimeData[mimeName]
  if (mime.extensions) {
    for (let ext of mime.extensions) {
      mimes['.' + ext] = mimeName
    }
  }
}

const server = createServer(({ url }, res) => {
  res.setHeader('Transfer-Encoding', 'chunked')

  if (url === '/favicon.ico') {
    res.setHeader('Content-Type', 'image/png')
    return createReadStream(join(__dirname, 'favicon.png')).pipe(res)
  }

  let filePath = join(entry, url)

  url === '/'
    ? filePath += 'index.html'
    : !extname(filePath) && (filePath += '.html')

  const type = mimes[extname(filePath)]
  res.setHeader('Content-Type', type)

  const sendError = err => {
    console.error(err)
    res.setHeader('Content-Type', 'text/plain')
    res.statusCode = err.code === 'ENOENT' ? 404 : 400
    res.end(`${res.statusCode} ${STATUS_CODES[res.statusCode]} ${url}`)
  }

  if (type === 'text/html') {
    readFile(filePath, 'utf8', (err, data) => {
      if (err) return sendError(err)
      const point = data.indexOf('</head>')
      res.end(data.slice(0, point) + embed + data.slice(point))
    })
  } else {
    createReadStream(filePath).on('error', sendError).pipe(res)
  }
})

const ws = new WebSocket.Server({ server, clientTracking: true })
let lastError = null

ws.on('connection', client => {
  if (lastError) client.send(lastError)
  client.on('error', err => console.error(err))
  client.on('message', raw => {
    let data = JSON.parse(raw)

    switch (data[0]) {
      case 'update': {
        echo('Reloaded by ' + data[1])
        lastError = null
        break
      }
      case 'error': {
        echo('Reload failed', console.error)
        lastError = raw
        break
      }
      default: echo('Reload failed (Bad type ' + data[0] + ')', console.error)
    }

    for (const peer of ws.clients) {
      peer !== client && peer.send(raw)
    }
  })
})

server.listen(DEV_SERVER_PORT, DEV_SERVER_ADDRESS, () => {
  const client = new WebSocket(`ws://${DEV_SERVER_ADDRESS}:${DEV_SERVER_PORT}`)
  client.on('error', err => echo(err.message, console.error))
  client.on('open', () => {
    echo(`Waiting for reloads at http://${DEV_SERVER_ADDRESS}:${DEV_SERVER_PORT}`)
    watchExec(
      argv,
      chunk => process.stderr.write(chunk),
      evt => client.send(JSON.stringify([evt.type, evt.data]))
    )
  })
})
