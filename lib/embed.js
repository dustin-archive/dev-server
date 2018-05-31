
function error (err) {
  var pre = document.createElement('pre')

  pre.style = 'padding:12px;border:0;color:red'
  pre.innerText = err.message

  document.body.innerHTML = ''
  document.body.appendChild(pre)
}

function connect (first) {
  var ws = new WebSocket('ws://' + window.location.host)

  ws.onopen = function () {
    if (!first) window.location.reload()
  }

  ws.onmessage = function (data) {
    try {
      data = JSON.parse(data.data)
    } catch (err) {
      error(err)
    }

    switch (data[0]) {
      case 'update': window.location.reload()
        break
      case 'error': error(new Error(data[1]))
        break
      default: error(new Error('Reloader received unknown message ' + data[0]))
    }
  }

  ws.onclose = function () {
    setTimeout(connect, 2500)
  }
}

connect(true)
