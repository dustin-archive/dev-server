#!/usr/bin/env node

const { createInterface } = require('readline')
const { createReadStream, readFile, readFileSync } = require('fs')
const { createServer, STATUS_CODES } = require('http')
const { extname, join, resolve } = require('path')
const WebSocket = require('ws')
const mimeData = require('mime-db')
const { exec } = require('child_process')
const minimatch = require('minimatch')
const watch = require('recursive-watch')

const types = [ '--watch', '--watch-silent' ]
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

function startServer (http, ws) {
  http.on('request', ({ url }, res) => {
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

  ws.on('connection', client => {
    client.on('error', err => console.error(err))
    client.on('message', raw => {
      let data = JSON.parse(raw)

      switch (data.name) {
        case 'update': echo('Reloaded by ' + data.message); break
        case 'error': echo('Reload failed', console.error); break
        default: echo('Reload failed (Bad type ' + data.name + ')', console.error)
      }

      for (const peer of ws.clients) {
        peer !== client && peer.send(raw)
      }
    })
  })

  http.listen(DEV_SERVER_PORT, DEV_SERVER_ADDRESS, () => {
    const client = new WebSocket(`ws://${DEV_SERVER_ADDRESS}:${DEV_SERVER_PORT}`)
    client.on('error', err => echo(err.message, console.error))
    client.on('open', () => {
      echo(`Waiting for reloads at http://${DEV_SERVER_ADDRESS}:${DEV_SERVER_PORT}`)
      startWatch(client)
    })
  })
}

function startWatch (client) {
  const send = (name, message) => {
    client.send(JSON.stringify({ name, message }))
  }

  for (let i = 0; i < argv.length; i += 3) {
    let [ type, input, command ] = argv.slice(i, i + 3)

    const glob = resolve(input)
    const baseEnd = glob.indexOf('/*')
    const silent = type === '--watch-silent'

    if (types.indexOf(type) === -1) {
      throw new Error('Expected a watcher type but got ' + type)
    } else if (baseEnd === -1) {
      throw new Error('Unrecognized glob ' + glob)
    }

    watch(glob.slice(0, baseEnd), file => {
      if (minimatch(file, glob)) {
        if (command) {
          const sub = exec(command, {
            shell: process.env.SHELL,
            env: Object.assign({ _FILE: file }, process.env),
            maxBuffer: Infinity,
            encoding: 'buffer'
          })

          sub.on('error', err => {
            send('error', err.message)
          })

          let stderr = ''
          if (!silent) {
            sub.stdout.pipe(process.stderr)
            sub.stderr.on('data', chunk => {
              process.stderr.write(chunk)
              stderr += chunk.toString()
            })
          }

          sub.on('exit', code => {
            if (code === 0 && !stderr) {
              send('update', file)
            } else if (!silent) {
              send('error', stderr)
            }
          })
        } else {
          send('update', file)
        }
      }
    })
  }
}

const server = createServer()
startServer(server, new WebSocket.Server({ server, clientTracking: true }))
