'use strict';

var executor = require('./common/executor.js');
var poller = require('./common/poller.js');
var util = require('util');

module.exports = function () {
  var who = util.format('%s|%s', global.who, 'worker');
  logger.info(who, 'Inside');

  var pollerOpts = {
    filePath: global.config.jobWhoPath,
    intervalMS: global.config.pollIntervalMS,
    content: 'reqKick'
  };

  poller(pollerOpts,
    function (err, handoffPoll) {
      if (err) {
        logger.error(
          util.format('%s: Failed to setup poller with error: %s', who, err)
        );
      } else {
        handoffPoll.on('match', function () {
          logger.verbose(
            util.format('%s: Received handoff. Stopping poll. ' +
              'Starting execution.', who
            )
          );

          handoffPoll.stop();
          executor(
            function () {
              handoffPoll.watch();
              logger.verbose(
                util.format('%s: Execution complete. Starting poll again.', who)
              );
            }
          );
        });
      }
    }
  );
};
