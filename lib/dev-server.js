#!/usr/bin/env node

// Node
const fs = require('fs') // { createReadStream, readFile, readFileSync }
const http = require('http') // { createServer, STATUS_CODES }
const path = require('path') // { extname, join, resolve }

// Dependencies
const mimeData = require('mime-db')
const watchExec = require('@jamen/watch-exec')
const WebSocket = require('ws')

// Command line
const directory = path.resolve(process.argv[2] || process.cwd())
const watchFlags = process.argv.slice(3)

// Environment variables
const {
  DEV_SERVER_ADDRESS = 'localhost',
  DEV_SERVER_PORT = 3000
} = process.env

// Browser reload script
const embed = fs.readFileSync(path.join(__dirname, 'embed.js'), 'utf8')
const script = `<script>${embed}</script>`

// Send timestamped messages to stdout
const echo = (message, fn = console.log) => {
  fn(new Date().toTimeString() + ' ' + message)
}

// Remap mime types with extensions from mime-db
const mimes = {}

for (let mimeName in mimeData) {
  let extensions = mimeData[mimeName].extensions

  if (extensions) {
    for (let ext of extensions) {
      mimes['.' + ext] = mimeName
    }
  }
}

// Create server
const server = http.createServer((req, res) => {
  res.setHeader('Transfer-Encoding', 'chunked')

  if (req.url === '/favicon.ico') {
    res.setHeader('Content-Type', 'image/png')
    return fs.createReadStream(path.join(__dirname, 'favicon.png')).pipe(res)
  }

  let filePath = path.join(directory, req.url)

  req.url === '/'
    ? filePath += 'index.html'
    : !path.extname(filePath) && (filePath += '.html')

  path.extname(filePath) === '.html' && (filePath = '/index.html')

  const type = mimes[path.extname(filePath)]
  res.setHeader('Content-Type', type)

  const sendError = err => {
    console.error(err)
    res.setHeader('Content-Type', 'text/plain')
    res.statusCode = err.code === 'ENOENT' ? 404 : 400
    res.end(`${res.statusCode} ${http.STATUS_CODES[res.statusCode]} ${req.url}`)
  }

  if (type === 'text/html') {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return sendError(err)
      const point = data.indexOf('</head>')
      res.end(data.slice(0, point) + script + data.slice(point))
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
      case 'update':
        echo('Reloaded by ' + data[1])
        lastError = null
        break
      case 'error':
        echo('Reload failed', console.error)
        lastError = raw
        break
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
