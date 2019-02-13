'use strict';

module.exports = function (req, res, next) {
  res.sseSetup = function() {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })
  }

  res.sseSend = function(path,data) {
    res.write("data: " + JSON.stringify(data) + "\n\n");
  }

  var reqAccept = req.headers['accept'];
    if (reqAccept != undefined && reqAccept.includes('text/event-stream')){
      req.isSSE = true;
    }else{
      req.isSSE = false;
    }

  next()
}