'use strict';

var self = ScriptExecutor;
module.exports = self;

var spawn = require('child_process').spawn;

function ScriptExecutor(scriptPath, args, callback) {
  var process = spawn(scriptPath, args);
  process.on('exit',
    function (exitCode, signal) {
      var err;
      if (exitCode || signal)
        err = exitCode || signal;
      return callback(err);
    }
  );
}
