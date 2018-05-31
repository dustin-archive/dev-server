#!/usr/bin/env node

// Node
const fs = require('fs') // { createReadStream, existsSync, readFile, readFileSync }
const http = require('http') // { createServer, STATUS_CODES }
const path = require('path') // { extname, join, resolve }
const zlib = require('zlib')
const gzip = zlib.createGzip()

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

// Server
const host = `${DEV_SERVER_ADDRESS}:${DEV_SERVER_PORT}`

// Browser reload script
const embed = fs.readFileSync(path.join(__dirname, 'embed.js'), 'utf8')
const script = `<script>${embed}</script>`

// Send timestamped messages to stdout
const echo = (message, fn = console.log) => {
  fn(`${new Date().toTimeString()} ${message}`)
}

// Remap mime types with extensions from mime-db
const mimes = {}

for (let name in mimeData) {
  let extensions = mimeData[name].extensions

  // Not all mime types have extensions
  if (extensions) {
    for (let extension of extensions) {
      mimes[`.${extension}`] = name
    }
  }
}

// Create server
const server = http.createServer((req, res) => {
  res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Transfer-Encoding', 'chunked')

  // Send errors
  const sendError = err => {
    console.error(err)

    res.statusCode = 400

    if (err.code === 'ENOENT') {
      // Suppress browser errors begging for a favicon
      if (req.url === '/favicon.ico') {
        res.setHeader('Content-Type', 'image/png')
        fs.createReadStream(path.join(__dirname, 'favicon.png')).pipe(gzip).pipe(res)

        // Void return
        return
      }

      res.statusCode = 404
    }

    res.setHeader('Content-Type', 'text/plain')
    res.end(`${res.statusCode} ${http.STATUS_CODES[res.statusCode]} ${req.url}`)
  }

  let file = path.join(directory, req.url)

  // If a file has no extension serve the html file at that location
  // If there's no html file serve index.html
  if (!path.extname(req.url)) {
    file += '.html'
    file = fs.existsSync(file) ? file : path.join(directory, 'index.html')
  }

  const extension = path.extname(file)

  res.setHeader('Content-Type', mimes[extension])

  if (extension === 'html') {
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) {
        sendError(err)

        // Void return
        return
      }

      const point = data.indexOf('</head>')
      const input = data.slice(0, point) + script + data.slice(point)

      zlib.gzip(input, (err, buffer) => {
        if (err) {
          sendError(err)

          // Void return
          return
        }

        res.end(buffer)
      })
    })

    // Void return
    return
  }

  fs.createReadStream(file).on('error', sendError).pipe(gzip).pipe(res)
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
        echo(`Reloaded by ${data[1]}`)
        lastError = null
        break
      case 'error':
        echo('Reload failed', console.error)
        lastError = raw
        break
      default: echo(`Reload failed (Bad type ${data[0]})`, console.error)
    }

    for (const peer of ws.clients) {
      peer !== client && peer.send(raw)
    }
  })
})

server.listen(DEV_SERVER_PORT, DEV_SERVER_ADDRESS, () => {
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
