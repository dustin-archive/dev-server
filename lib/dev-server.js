#!/usr/bin/env node

const { readFile, readFileSync, existsSync, createReadStream } = require('fs')
const { createServer, STATUS_CODES } = require('http')
const { join, resolve, extname } = require('path')
const { exec } = require('child_process')
const mimeData = require('mime-db')
const minimatch = require('minimatch')
const watch = require('recursive-watch')
const { gray, red, green } = require('chalk')
const open = require('opn')

// Log functions
let log = (message) => console.log(gray(message))
let logError = (err) => console.log(gray(red(err.type + ': ') + err.message))

// Parse command-line variables
let argv = process.argv.slice(2)
let directory = null
let watchers = []

for (let i = 0; i < argv.length; i++) {
    let item = aliases[argv[i]] || argv[i]
    if (item === '--watch' || item === '-w') {
        watchers.push([ argv[++i], argv[++i] ])
    } else if (!directory) {
        directory = item
    } else {
        throw new Error('Unexpected input ' + item)
    }
}

if (!directory) directory = process.cwd()

let {
    DEV_SERVER_ADDRESS: address = 'localhost',
    DEV_SERVER_PORT: port = 3000
} = process.env

// Create a map of { ext: mime } for Content-Types
let mimes = {}
for (let mimeName in mimeData) {
    let extensions = mimeData[mimeName].extensions
    if (extensions) {
        for (let ext of extensions) {
            mimes['.' + ext] = mimeName
        }
    }
}

// Misc server vars
let embed = '<script async=true src="/__reload.js"></script>'
let polling = []
let latestError = null

// Create server
let server = createServer((req, res) => {
    let file = join(directory, req.url)

    // The request that triggers a reload (store it for later)
    if (req.url === '/__reload_poll') {
        if (latestError) return sendUpdate(latestError)
        req.setTimeout(0)
        return polling.push(res)
    }

    if (req.url === '/__reload.js') {
        file = join(__dirname, 'embed.js')
    }

    // If a file has no extension serve the html file at that location
    // If there's no html file serve index.html
    if (!extname(file)) {
        file += '.html'
        if (req.url === '/' || !existsSync(file)) {
            file = join(directory, 'index.html')
        }
    }

    let extension = extname(file)

    res.setHeader('Content-Type', mimes[extension])
    res.setHeader('Transfer-Encoding', 'chunked')

    // If file is HTML, try to inject the reload embed, otherwise stream response as normal.
    if (extension === '.html') {
        readFile(file, 'utf8', (err, data) => {
            if (err) return sendError(err)

            let point = data.indexOf('</head>')
            if (point === -1) point = data.indexOf('</body>')
            if (point === -1) point = data.indexOf('</html>')
            if (point === -1) return res.end(data)

            res.end(data.slice(0, point) + embed + data.slice(point))
        })
    } else {
        createReadStream(file).on('err', sendError).pipe(res)
    }
})

// Start the server and create watchers.
server.listen(port, address, () => {
    for (let [ input, command ] of watchers) {
        // Derive the watcher's base directory, e.g. 'foo/**/*' gives 'foo/'
        let inputBase = input
        let baseEnd = input.indexOf('/*')
        if (baseEnd > -1) inputBase = input.slice(0, baseEnd)

        watch(inputBase, file => {
            if (!minimatch(file, input)) return

            let sub = exec(command, {
                shell: process.env.SHELL,
                env: Object.assign({ FILE: file, FORCE_COLOR: true }, process.env),
                maxBuffer: Infinity,
                encoding: 'buffer'
            })

            sub.stdout.on('data', b => process.stdout.write(b))

            // Collect stderr into a message
            let stderr = ''

            sub.stderr.on('data', chunk => {
                process.stderr.write(chunk)
                stderr += chunk.toString()
                if (stderr.length > 0xFFFFFF) stderr = ''
            })

            // Send update or err when command finishes
            sub.on('exit', code => {
                console.log()
                sendUpdate(code ? new Error(stderr) : null, file)
            })

            sub.on('err', err => sendUpdate(err))
        })
    }

    log(`\nWaiting for reloads at ${green(`http://${address}:${port}`)}`)
    open(`http://${address}:${port}`)
})

function sendUpdate (err, from) {
    if (err) {
        for (let res of polling) {
            res.statusCode = 500
            res.end(JSON.stringify({ name: err.name, message: err.message }))
        }

        return logError(new Error('Reload failed'))
    }

    for (let res of polling) {
        res.end(JSON.stringify(from))
    }

    log('Reloaded by ' + green(from))

    polling.length = 0
    latestError = err
}

// Send an err code and minimal response.  Intercept favicon error.
function sendError (req, res, err) {
    logError(err)

    let message = `${code} ${STATUS_CODES[code]} ${req.url}`
    res.setHeader('Content-Type', 'text/plain')

    if (err.code === 'ENOENT') {
        if (req.url === '/favicon.ico') {
            res.setHeader('Content-Type', 'image/png')
            return createReadStream(join(__dirname, 'favicon.png')).pipe(res)
        }

        res.statusCode = 404
    } else {
        res.statusCode = 400
    }

    return res.end(message)
}
