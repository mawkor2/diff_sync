var io = require('socket.io'),
  http = require('http'),
  sys = require('sys'),
  fs = require('fs'),
  url = require('url'),
  path = require('path'),
  util = require('util'),
  express = require('express'),
  redis = require('redis');
  dmpmod = require('diff_match_patch'),
  dmp = new dmpmod.diff_match_patch();
  client = redis.createClient();

function findType(uri) {
  if (!uri) { return undefined };
  switch ((uri.match(/\.\w+$/gi))[0]) {
    case '.js':
      return 'text/javascript';
    case '.html': 
      return 'text/html';
    case '.css': 
      return 'text/css';
    case  '.manifest':
      return 'text/cache-manifest';
    case '.ico': 
      return 'image/x-icon';
    case '.jpeg': 
      return 'image/jpeg';
    case '.jpg': 
      return 'image/jpg';
    case '.png': 
      return 'image/png';
    case '.gif': 
      return 'image/gif';
    case '.svg': 
      return 'image/svg+xml';
    default:
      return undefined;
  }
};

function sendError(code, response) {
  response.writeHead(code);
  response.end();
  return;
};

var app = express.createServer();

app.get('*', function(req, res) {
  var uri = url.parse(req.url).pathname;
 
  var _file = path.join(process.cwd(), uri);
  
  path.exists(_file, function(exists) {
    if (!exists) {
      sendError(404, res);
    } else {
      fs.stat(_file, function(err, stat) {
        //var file = __dirname + uri,
        var file = _file,
          type = findType(uri),
          size = stat.size;
        if (!type) {
          sendError(500, res);
        }
        res.writeHead(200, {'Content-Type':type, 'Content-Length':size});
        var rs = fs.createReadStream(file);
        util.pump(rs, res, function(err) {
          if (err) {
            console.log("ReadStream, WriteStream error for util.pump");
            res.end();
          }
        });
      });
    };
  });
}).listen(80);

io = io.listen(app);

io.sockets.on('connection', function(socket) {
  socket.emit('log', { 'connection': 'established' });
  
  socket.on('diff sync', function(data) {
    diff_sync.io.recv(data);
  });

  socket.on('disconnect', function () {
    console.log('user disconnected');
  });

});


var diff_sync = function(flags) {
  var _text = '';
  var _shadow = '';
    var patchUpstreamOnRecv = (typeof flags.patchUpstreamOnRecv !== 'boolean') ? false : flags.patchUpstreamOnRecv;  
    var serverOverridePreferred = (typeof flags.serverOverridePreferred !== 'boolean') ? true : flags.serverOverridePreferred;

  var getLocalText = function(callback) {
    client.get("local text", function(err, reply) {
      callback(err, reply);
    });
  };
  var getLocalShadow = function() {
    client.get("local shadow", function(err, reply) {
      callback(err, reply);
    });
  };
  var setLocalText = function(value) {
    client.set("local text", value);
  };
  var setLocalShadow = function(value) {
    client.set("local shadow", value);
  };

  return {
    patchUpstreamOnRecv: patchUpstreamOnRecv,
    serverOverridePreferred: serverOverridePreferred,
    init: function() {
      _text = 'Once you discover the simplest solution, whatever remains, however improbable, is unlikely the truth.';
      _shadow = 'Once you eliminate the impossible, whatever remains, no matter how improbable, must be the truth.';
    },
    computeDiff: function(textOld, textNew) {
      var diffs = dmp.diff_main(textOld, textNew, true); 
      dmp.diff_cleanupSemantic(diffs);
      return diffs;
    },

    patchLocalShadow: function(patches) {
      var oPatch = dmp.patch_apply(patches, getLocalShadow());
      _shadow = oPatch[0];
      console.log(_shadow); 
      for (var i=0;i<oPatch[1].length;i++) {
        /* if (!oPatch[1][i]) {
          TODO: handle patch failures 
        } */ 
      };
      return oPatch;
    },
    patchLocalText: function(patches) {
      var oPatch = dmp.patch_apply(patches, getLocalText());
      _text = oPatch[0]; 
      console.log(_text);
      for (var i=0;i<oPatch[1].length;i++) {
        /* if (!oPatch[1][i]) {
          TODO: handle patch failures 
        } */          
      };
      return oPatch;
    },
    send: function(data) {
      var text1 = getLocalShadow();
      var text2 = getLocalText();

      var callback = function() {
      var diffs = this.computeDiff(text1, text2);
        if (diffs.length > 0) {
          var patches = dmp.patch_make(text1, diffs);
          setLocalShadow(text2);
          console.log(text2);
          console.log(getLocalShadow());
          this.io.send({'patches': patches});
        };
      };
    },
    recv: function(data) {
      if (typeof data.full_transmission !== 'undefined') {
        // in case of failure, allow for full client reset of the content to the server version
        setLocalText(data.full_transmission);
        setLocalShadow(data.full_transmission);
      }
      else {
        this.patchLocalText(data.patches);
        this.patchLocalShadow(data.patches);
        if (this.patchUpstreamOnRecv) {
          this.send({});
        };
      };
    },
    io: {
      recv: function(data) { 
        diff_sync.recv(data);
      },
      send: function(data) {
        var payload = {'patches' : data.patches };
        console.log('net:send[' + JSON.stringify(payload) + ']');
        // TODO: implement conflict resolution logic
        io.sockets.emit('diff sync', payload);
      }
    }
  };
}(true, true);

diff_sync.init();




