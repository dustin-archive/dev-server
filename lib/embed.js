
function error (err) {
    var pre = document.createElement('pre')

    pre.style = 'padding:12px;border:0;color:red'
    pre.innerText = err.message

    document.body.innerHTML = ''
    document.body.appendChild(pre)
}

// Wait until other resources have loaded (prevents a race condition with the
// setTimeout below)
window.addEventListener('DOMContentLoaded', () => {
    // setTimeout hack to make the long-polling request inside be treated as a
    // background resource (otherwise you get "the throbber of doom")
    setTimeout(() => {
        // Long-polling request, that when fufilled, reloads the browser or
        // displays an error
        fetch('/__reload_poll', { keepalive: true })
        .then(resp => resp.status === 200 ? window.location.reload() : resp.text())
        .then(remoteErr => remoteErr && Promise.reject(remoteErr))
        .catch(err => error(err))
    }, 10)
})
