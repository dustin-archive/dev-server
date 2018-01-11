<script>
  function error (err) {
    document.body.innerHTML =
      '<pre><code style="color:red;font-size:1.2em;">' + err.message + '</code></pre>'
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
      switch (data.name) {
        case 'update': location.reload(); break
        case 'error': error(new Error(data.message)); break
        default: error(new Error('Reloader received unknown message ' + data.name))
      }
    }
    ws.onclose = function () {
      setTimeout(connect, 2500)
    }
  })(true)
</script>
