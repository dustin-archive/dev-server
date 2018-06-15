#!/usr/bin/env node

const { readFile, readFileSync, existsSync, createReadStream } = require('fs')
const { createServer, STATUS_CODES } = require('http')
const { join, resolve, extname } = require('path')
const { exec } = require('child_process')
const mimeData = require('mime-db')
const WebSocket = require('ws')
const minimatch = require('minimatch')
const watch = require('recursive-watch')
const open = require('opn')

// Command-line variables
let argv = process.argv.slice(2)
let directory = null
let pushstate = false
let watchers = []

let aliases = {
    '-w': '--watch',
    '-p': '--pushstate'
}

for (let i = 0; i < argv.length; i++) {
    let item = aliases[argv[i]] || argv[i]
    if (item === '--watch') {
        watchers.push([ argv[++i], argv[++i] ])
    } else if (item === '--pushstate') {
        pushstate = true
    } else if (!directory) {
        directory = item
    } else {
        throw new Error('Unexpected input ' + item)
    }
}

if (!directory) {
    directory = process.cwd()
}

// Environment variables
let {
    DEV_SERVER_ADDRESS: address = 'localhost',
    DEV_SERVER_PORT: port = 3000
} = process.env

// Browser reload script
let script = `<script>${readFileSync(join(__dirname, 'embed.js'), 'utf8')}</script>`

// Send timestamped messages to stdout
let echo = (message, fn = console.log) => {
    fn(new Date().toTimeString() + ' ' + message)
}

// Remap mime types with extensions from mime-db
let mimes = {}

for (let mimeName in mimeData) {
    let extensions = mimeData[mimeName].extensions

    if (extensions) {
        for (let ext of extensions) {
            mimes['.' + ext] = mimeName
        }
    }
}

// Create HTTP server
let server = createServer((req, res) => {
    // If a file has no extension serve the html file at that location
    // If there's no html file serve index.html
    let file = join(directory, req.url)
    if (!extname(file)) {
        file += '.html'
        if (req.url === '/' || pushstate && !existsSync(file)) {
            file = join(directory, 'index.html')
        }
    }

    let extension = extname(file)

    res.setHeader('Content-Type', mimes[extension])
    res.setHeader('Transfer-Encoding', 'chunked')

    // Send an error code and minimal response.  If favicon.ico error, send a default one.
    let sendError = err => {
        echo(err.toString(), console.error)

        let sendCode = code => {
            res.setHeader('Content-Type', 'text/plain')
            res.statusCode = code
            res.end(`${code} ${STATUS_CODES[code]} ${req.url}`)
        }

        if (err.code === 'ENOENT') {
            if (req.url === '/favicon.ico') {
                res.setHeader('Content-Type', 'image/png')
                return createReadStream(join(__dirname, 'favicon.png')).pipe(res)
            }

            return sendCode(404)
        }

        return sendCode(400)
    }

    // If file is HTML, try to inject the reload script, otherwise stream response as normal.
    if (extension === 'html') {
        readFile(file, 'utf8', (err, data) => {
            if (err) return sendError(err)

            let point = data.indexOf('</head>')
            if (point === -1) point = data.indexOf('</body>')
            if (point === -1) point = data.indexOf('</html>')
            if (point === -1) return res.end(data)

            res.end(data.slice(0, point) + script + data.slice(point))
        })
    } else {
        createReadStream(file).on('error', sendError).pipe(res)
    }
})

// Create the server that listens for reloads.
let ws = new WebSocket.Server({ server, clientTracking: true })
let lastError = null

ws.on('connection', client => {
    if (lastError) client.send(lastError)

    // Handle reload messages
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
            default:
                echo('Reload failed (Bad type ' + data[0] + ')', console.error)
        }

        // Broadcast message to the rest of the peers
        for (let peer of ws.clients) {
            if (peer !== client) peer.send(raw)
        }
    })

    client.on('error', err => console.error(err))
})

server.listen(port, address, () => {
    let client = new WebSocket(`ws://${address}:${port}`)
    let send = data => client.send(JSON.stringify(data))

    client.on('open', () => {
        // Create watchers
        for (let [ input, command ] of watchers) {
            // Derive the watcher's base directory, e.g. 'foo/**/*' gives 'foo/'
            let inputBase = input
            let baseEnd = input.indexOf('/*')
            if (baseEnd > -1) inputBase = input.slice(0, baseEnd)

            watch(inputBase, file => {
                if (minimatch(file, input)) {
                    // Run watcher's command
                    let sub = exec(command, {
                        shell: process.env.SHELL,
                        env: Object.assign({ FILE: file }, process.env),
                        maxBuffer: Infinity,
                        encoding: 'buffer'
                    })

                    // Collect stderr into a message
                    let stderr = ''
                    sub.stdout.on('data', output)
                    sub.stderr.on('data', chunk => {
                        output(chunk)
                        stderr += chunk.toString()
                        if (stderr.length > 0xFFFFFF) {
                            stderr = ''
                        }
                    })

                    // Send update or error when command finishes
                    sub.on('exit', code => {
                        if (code === 0) {
                            send([ 'update', file ])
                        } else {
                            send([ 'error', stderr ])
                        }
                    })

                    sub.on('error', error => {
                        send([ 'error', error.message ])
                    })
                }
            })
        }

        echo(`Waiting for reloads at http://${address}:${port}`)
        open(`http://${address}:${port}`)
    })

    client.on('error', err => echo(err.message, console.error))
})
