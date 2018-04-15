#!/usr/bin/env node

// { createReadStream, readFile, readFileSync }
const fs = require('fs')

// { createServer, STATUS_CODES }
const http = require('http')

// { extname, join, resolve }
const path = require('path')

const WebSocket = require('ws')
const mimeData = require('mime-db')

const watchExec = require('@jamen/watch-exec')

// Command line interface
const pushState = process.argv.indexOf('--pushState') > 0
const watchFlags = process.argv.slice(process.argv.indexOf('--watch'))
const embed = fs.readFileSync(path.join(__dirname, 'embed.js'), 'utf8')
const entry = path.resolve(process.argv[2] || process.cwd())
const { DEV_SERVER_ADDRESS = 'localhost', DEV_SERVER_PORT = 3000 } = process.env
const mimes = {}

// Write messages to stdout
const echo = (message, fn = console.log) => {
  fn(new Date().toTimeString() + ' ' + message)
}

for (let mimeName in mimeData) {
  let extensions = mimeData[mimeName].extensions

  if (extensions) {
    for (let ext of extensions) {
      mimes['.' + ext] = mimeName
    }
  }
}

const server = http.createServer(({ url }, res) => {
  res.setHeader('Transfer-Encoding', 'chunked')

  if (url === '/favicon.ico') {
    res.setHeader('Content-Type', 'image/png')
    return fs.createReadStream(path.join(__dirname, 'favicon.png')).pipe(res)
  }

  let filePath = path.join(entry, url)

  url === '/'
    ? filePath += 'index.html'
    : !path.extname(filePath) && (filePath += '.html')

  pushState && path.extname(filePath) === '.html' && (url = '/index.html')

  const type = mimes[path.extname(filePath)]
  res.setHeader('Content-Type', type)

  const sendError = err => {
    console.error(err)
    res.setHeader('Content-Type', 'text/plain')
    res.statusCode = err.code === 'ENOENT' ? 404 : 400
    res.end(`${res.statusCode} ${http.STATUS_CODES[res.statusCode]} ${url}`)
  }

  if (type === 'text/html') {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return sendError(err)
      const point = data.indexOf('</head>')
      res.end(data.slice(0, point) + embed + data.slice(point))
    })
  } else {
    fs.createReadStream(filePath).on('error', sendError).pipe(res)
  }
})

const ws = new WebSocket.Server({ server, clientTracking: true })
let lastError = null

ws.on('connection', client => {
  lastError && client.send(lastError)

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
  const host = `${DEV_SERVER_ADDRESS}:${DEV_SERVER_PORT}`
  const client = new WebSocket(`ws://${host}`)

  client.on('error', err => echo(err.message, console.error))
  client.on('open', () => {
    echo(`Waiting for reloads at http://${host}`)
    watchExec(
      watchFlags,
      process.stderr.write,
      e => client.send(JSON.stringify([e.type, e.data]))
    )
  })
})
