'use strict';

var self = BuildAgent;
module.exports = self;

var amqp = require('amqp');
var ShippableAdapter = require('../helpers/shippable/APIAdapter.js');

var checkHealth = require('../helpers/healthChecks/checkHealth.js');
var validateNode = require('../helpers/healthChecks/validateNode.js');
var postNodeStats = require('../helpers/healthChecks/postNodeStats.js');
var executeAffinityGroup = require('../execute/executeAffinityGroup.js');

function BuildAgent() {
  logger.info('Starting', name);
  this.AMQPConnection = {};
  this.queue = {};
  this.ackWaitTimeMS = 2 * 1000;  // 2 seconds
  this.timeoutLength = 1;
  this.timeoutLimit = 180;
  this.checkHealth = checkHealth;
  this.validateNode = validateNode;
  this.postNodeStats = postNodeStats;
  this.executeAffinityGroup = executeAffinityGroup;
  this.publicAdapter = new ShippableAdapter('');
  this.nodeId = config.nodeId;
}

BuildAgent.prototype.init = function () {
  logger.verbose('Initializing', name);
  async.series([
      this.checkHealth.bind(this),
      this.getSystemCodes.bind(this),
      this.establishQConnection.bind(this),
      this.connectExchange.bind(this),
      this.connectToQueue.bind(this),
      this.updateClusterNodeStatus.bind(this),
      this.postNodeStats.bind(this),
      this.validateNode.bind(this)
    ],
    function (err) {
      if (err)
        return this.error(err);

    }.bind(this)
  );
};

BuildAgent.prototype.getSystemCodes = function (next) {
  logger.verbose(util.format('%s| getting systemCodes', name));

  var query = '';
  this.publicAdapter.getSystemCodes(query,
    function (err, systemCodes) {
      if (err) {
        logger.warn('Failed to getSystemCodes with error: ' + err.message);
        return next(true);
      }

      if (_.isEmpty(systemCodes)) {
        logger.warn('No systemCodes found');
        return next(true);
      }

      global.systemCodesByCode = _.indexBy(systemCodes, 'code');
      global.systemCodesByName = _.indexBy(systemCodes, 'name');
      return next();
    }
  );
};

BuildAgent.prototype.establishQConnection = function (next) {
  logger.verbose(util.format('Connecting %s to Q %s', name, config.amqpUrl));
  this.AMQPConnection = amqp.createConnection({
      url: config.amqpUrl,
      heartbeat: 60
    }, {
      defaultExchangeName: config.amqpExchange,
      reconnect: false
    }
  );

  this.AMQPConnection.on('ready',
    function () {
      logger.verbose(
        util.format('Connected %s to Q %s', name, config.amqpUrl)
      );
      return next();
    }.bind(this)
  );

  this.AMQPConnection.on('error',
    function (connection, err) {
      if (connection && !connection.closing) {
        logger.error(
          util.format('Failed to connect %s to Q %s', name, config.amqpUrl)
        );
        return this.error(err);
      }
    }.bind(this, this.AMQPConnection)
  );

  this.AMQPConnection.on('close',
    function (connection) {
      logger.verbose(
        util.format('Closed connection from %s to Q %s', name,
          config.amqpUrl)
      );

      // If this is not a close connection event initiated by us, we should try
      // to reconnect.
      if (!connection.closing) {
        this.timeoutLength = 1;
        this.timeoutLimit = 180;
        return this.init();
      }
    }.bind(this, this.AMQPConnection)
  );
};

BuildAgent.prototype.error = function (err) {
  logger.error(err);
  logger.verbose(
    util.format('Since an error occurred, re-connecting %s to Q %s',
      name, config.amqpUrl)
  );
  async.series([
      this.disconnectQConnection.bind(this)
    ],
    function () {
      this.retry();
    }.bind(this)
  );
};

BuildAgent.prototype.disconnectQConnection = function (next) {
  try {
    this.AMQPConnection.closing = true;
    this.AMQPConnection.disconnect();
  } catch (ex) {
    logger.warn(
      util.format('Failed to close connection from %s to Q %s', name,
        config.amqpUrl)
    );
  }
  this.AMQPConnection = {};
  return next();
};

BuildAgent.prototype.retry = function () {
  this.timeoutLength *= 2;
  if (this.timeoutLength > this.timeoutLimit)
    this.timeoutLength = 1;

  logger.verbose(
    util.format('Waiting for %s seconds before re-connecting %s to Q %s',
      this.timeoutLength, name, config.amqpUrl)
  );
  setTimeout(this.init.bind(this), this.timeoutLength * 1000);
};

BuildAgent.prototype.connectExchange = function (next) {
  logger.verbose(
    util.format('Connecting %s to Exchange %s', name, config.amqpExchange)
  );
  this.AMQPConnection.exchange(
    config.amqpExchange, {
      passive: true,
      confirm: true
    },
    function (exchange) {
      logger.verbose(
        util.format('Connected %s to Exchange %s', name, exchange.name)
      );
      return next();
    }.bind(this)
  );
};

BuildAgent.prototype.connectToQueue = function (next) {
  logger.verbose(
    util.format('Connecting %s to Queue %s', name, config.inputQueue)
  );
  var queueParams = {
    passive: true
  };

  this.AMQPConnection.queue(config.inputQueue, queueParams,
    function (queue) {
      queue.bind(config.amqpExchange, queue.name);
      logger.verbose(
        util.format('%s is listening to Queue %s', name, queue.name)
      );
      var queueParams = {
        ack: true,
        prefetchCount: 1
      };
      this.queue = queue;

      queue.subscribe(queueParams, this.disconnectAndProcess.bind(this))
        .addCallback(
          function (ok) {
            this.consumerTag = ok.consumerTag;
          }.bind(this)
        );

      return next();
    }.bind(this)
  );
};

BuildAgent.prototype.disconnectAndProcess =
  function (message, headers, deliveryInfo, ack) {
    logger.verbose(
      util.format('Disconnecting from queue: %s and processing',
      config.inputQueue)
    );

    if (!this.consumerTag) {
      logger.warn('consumerTag not available yet, rejecting and listening.');
      ack.reject(true);
      return;
    }

    var bag = {
      who: util.format(name + '|init|%s', self.name),
      ack: ack,
      ackMessage: true,
      ackWaitTimeMS: this.ackWaitTimeMS,
      queue: this.queue,
      nodeId: this.nodeId,
      consumerTag: this.consumerTag,
      publicAdapter: this.publicAdapter,
      suAdapter: this.suAdapter
    };

    async.series([
        _validateClusterNode.bind(null, bag),
        _unsubscribeFromQueue.bind(null, bag),
        _ackMessage.bind(null, bag),
        _rejectMessage.bind(null, bag)
      ],
      function () {
        if (bag.ackMessage) {
          this.AMQPConnection.closing = true;
          global.config.isProcessingStep = true;
          this.AMQPConnection.disconnect();
          this.executeAffinityGroup(message);
        }
      }.bind(this)
    );
  };

function _validateClusterNode(bag, next) {
  if (!bag.nodeId) return next();

  var who = bag.who + '|' + _validateClusterNode.name;
  logger.debug(who, 'Inside');

  bag.publicAdapter.validateClusterNodeById(bag.nodeId,
    function (err, clusterNode) {
      if (err) {
        logger.warn(
          util.format(who, 'failed to :validateClusterNodeById for id: %s',
            bag.nodeId)
        );
        bag.ackMessage = false;
        return next();
      }

      if (clusterNode.action !== 'continue')
        bag.ackMessage = false;

      return next();
    }
  );
}

function _unsubscribeFromQueue(bag, next) {
  if (!bag.ackMessage) return next();

  var who = bag.who + '|' + _unsubscribeFromQueue.name;
  logger.debug(who, 'Inside');

  bag.queue.unsubscribe(bag.consumerTag)
    .addCallback(
      function () {
        return next();
      }
    );
}

function _ackMessage(bag, next) {
  if (!bag.ackMessage) return next();

  var who = bag.who + '|' + _ackMessage.name;
  logger.debug(who, 'Inside');

  bag.ack.acknowledge();
  setTimeout(
    function () {
      return next();
    },
    bag.ackWaitTimeMS
  );
}

function _rejectMessage(bag, next) {
  if (bag.ackMessage) return next();

  var who = bag.who + '|' + _rejectMessage.name;
  logger.debug(who, 'Inside');

  bag.ack.reject(true);
  setTimeout(
    function () {
      return next();
    },
    bag.ackWaitTimeMS
  );
}

BuildAgent.prototype.updateClusterNodeStatus = function (next) {
  if (!config.nodeId) {
    logger.verbose(util.format('%s| Skipping cluster node status update ' +
      'as no nodeId is present', name));
    return next();
  }
  logger.verbose(util.format('%s| updating cluster node status', name));

  var update = {
    statusCode: global.systemCodesByName.success.code,
    execImage: global.config.agentVersion,
    stepId: null
  };

  this.publicAdapter.putClusterNodeById(config.nodeId,
    update,
    function (err) {
      if (err) {
        logger.warn(
          util.format('Failed to update status of cluster node %s ' +
            'with err %s', config.nodeId, err)
        );
        return next(true);
      }
      logger.verbose(util.format('%s| updated cluster node status to success',
        name));
      return next();
    }
  );
};
