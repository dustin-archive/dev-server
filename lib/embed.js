<script>
  function error (err) {
    var pre = document.createElement('pre')
    pre.style.color = 'red'
    pre.style.border = '0'
    pre.innerText = err.message
    document.body.innerHTML = ''
    document.body.appendChild(pre)
  }
  ;(function connect (first) {
    var ws = new WebSocket('ws://' + location.host)
    ws.onopen = function () {
      if (!first) location.reload()
    }
    ws.onmessage = function (data) {
      try {
        data = JSON.parse(data.data)
      } catch (err) {
        error(err)
      }
      switch (data[0]) {
        case 'update': location.reload(); break
        case 'error': error(new Error(data[1])); break
        default: error(new Error('Reloader received unknown message ' + data[0]))
      }
    }
    ws.onclose = function () {
      setTimeout(connect, 2500)
    }
  })(true)
</script>
