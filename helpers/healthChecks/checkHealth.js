'use strict';
var self = checkHealth;
module.exports = self;

var checkAMQP = require('./checkAMQP.js');
var checkShippableApi = require('./checkShippableApi.js');

function checkHealth(callback) {
  var bag = {};
  bag.who = util.format('%s|helpers|healthChecks|%s', name, self.name);
  logger.verbose('Checking health of', bag.who);

  var params = {
    amqpExchange: config.amqpExchange,
    amqpUrl: config.amqpUrl
  };

  async.series([
      checkAMQP.bind(null, params),
      checkShippableApi.bind(null, params)
    ],
    function (err) {
      if (err)
        logger.error(bag.who, 'Failed health checks', err);
      else
        logger.verbose(bag.who, 'Successful health checks');
      return callback(err);
    }
  );
}
