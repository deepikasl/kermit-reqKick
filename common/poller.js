'use strict';

var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var util = require('util');

module.exports = function (opts, callback) {
  var who = util.format('%s|common|%s', global.who, 'poller');
  logger.info(who, 'Inside');

  // Error checks
  if (_.isEmpty(opts.filePath))
    return callback(util.format('%s: missing opts.filePath', who), null);

  if (!_.isNumber(opts.intervalMS))
    return callback(
      util.format('%s: expected number opts.intervalMS', who), null
    );

  if (_.isEmpty(opts.content))
    return callback(util.format('%s: missing opts.content', who), null);

  // Setup event emitter
  var poll = new EventEmitter();
  poll.watch = function () {
    if (poll.interval) poll.stop();

    poll.interval = setInterval(
      function () {
        fs.readFile(opts.filePath, 'utf8',
          function (err, data) {
            if (err) {
              logger.verbose(
                util.format('%s: failed to read file: %s with error: %s',
                  who, opts.filePath, err
                )
              );
              return;
            }

            var trimmedData = data.trim();
            if (_.isArray(opts.content) &&
              _.contains(opts.content, trimmedData))
              poll.emit('match', trimmedData);
            else if (opts.content === trimmedData)
              poll.emit('match');
          }
        );
    }, opts.intervalMS);
  };

  poll.stop = function () {
    clearInterval(poll.interval);
  };

  poll.watch();
  return callback(null, poll);
};
