'use strict';

var self = executeAffinityGroup;
module.exports = self;

var Adapter = require('../helpers/shippable/APIAdapter.js');
var StepConsoleAdapter =
  require('../helpers/shippable/StepConsoleAdapter.js');
var StepStatusPoller = require('../helpers/utilities/StepStatusPoller.js');
var scriptExecutor = require('../helpers/utilities/ScriptExecutor.js');

var path = require('path');

var cleanup = require('../helpers/utilities/cleanup.js');
var executeStep = require('./executeStep.js');

function executeAffinityGroup(message) {
  var bag = {
    rawMessage: message,
    baseDir: global.config.baseDir,
    pipelineDir: path.join(global.config.baseDir, 'pipelines'),
    execTemplatesDir: global.config.execTemplatesDir
  };

  bag.who = util.format('%s|execute|%s', name, self.name);
  logger.info(bag.who, 'Inside');

  async.series([
      _checkInputParams.bind(null, bag),
      _updateClusterNodeStatus.bind(null, bag),
      _cleanupPipelineDirectory.bind(null, bag),
      _executeGroupSteps.bind(null, bag),
      _cleanupPipelineDirectory.bind(null, bag)
    ],
    function (err) {
      if (err)
        logger.error(bag.who, util.format('Failed to process message'));
      else
        logger.info(bag.who, util.format('Successfully processed message'));
      __restart(bag);
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  if (_.isEmpty(bag.rawMessage)) {
    logger.warn(util.format('%s, Message is empty.', who));
    return next(true);
  }

  if (!bag.rawMessage.builderApiToken) {
    logger.warn(util.format('%s, No builderApiToken present' +
      ' in incoming message', who));
    return next(true);
  }

  if (_.isEmpty(bag.rawMessage.stepIds)) {
    logger.warn(util.format('%s, Steps are empty in incoming message', who));
    return next(true);
  }

  bag.builderApiToken = bag.rawMessage.builderApiToken;
  bag.builderApiAdapter = new Adapter(bag.rawMessage.builderApiToken);
  bag.stepIds = bag.rawMessage.stepIds;
  bag.affinityGroup = bag.rawMessage.affinityGroup;
  bag.runId = bag.rawMessage.runId;
  bag.stepStatusPoller = new StepStatusPoller(bag.builderApiAdapter,
    path.join(bag.baseDir, 'status', 'step.status'));
  return next();
}

function _updateClusterNodeStatus(bag, next) {
  var who = bag.who + '|' + _updateClusterNodeStatus.name;
  logger.verbose(who, 'Inside');

  var update = {
    statusCode: global.systemCodesByName.processing.code
  };

  bag.builderApiAdapter.putClusterNodeById(global.config.nodeId, update,
    function (err, clusterNode) {
      if (err) {
        logger.warn(util.format('%s, putClusterNodeById for nodeId %s failed ' +
          'with error: %s', bag.who, global.config.nodeId, err));
        return next(true);
      }
      bag.clusterNodeId = clusterNode.id;
      bag.clusterNodeName = clusterNode.friendlyName;
      return next();
    }
  );
}

function _cleanupPipelineDirectory(bag, next) {
  var who = bag.who + '|' + _cleanupPipelineDirectory.name;
  logger.verbose(who, 'Inside');

  var innerBag = {
    directory: bag.pipelineDir
  };

  cleanup(innerBag,
    function (err) {
      if (err) {
        logger.warn(util.format('%s, run directory cleanup failed ' +
          'with error: %s', bag.who, err));
        return next(true);
      }
      return next();
    }
  );
}

function _executeGroupSteps(bag, next) {
  var who = bag.who + '|' + _executeGroupSteps.name;
  logger.verbose(who, 'Inside');

  var innerBag = {
    who: bag.who,
    builderApiAdapter: bag.builderApiAdapter,
    builderApiToken: bag.builderApiToken,
    runId: bag.runId,
    affinityGroup: bag.affinityGroup,
    clusterNodeId: bag.clusterNodeId,
    clusterNodeName: bag.clusterNodeName,
    baseDir: bag.baseDir,
    groupComplete: false,
    execTemplatesDir: bag.execTemplatesDir,
    stepStatusPoller: bag.stepStatusPoller,
  };

  async.whilst(
    function () {
      return !innerBag.groupComplete;
    },
    function (callback) {
      async.series([
        _getNextStep.bind(null, innerBag),
        _getSteplets.bind(null, innerBag),
        _updateStepStatus.bind(null, innerBag),
        _updateStepletStatus.bind(null, innerBag),
        _executeStep.bind(null, innerBag)
      ],
      function () {
        return callback();
      }
    );
    },
    function () {
      return next();
    }
  );
}
function _getNextStep(bag, next) {
  var who = bag.who + '|' + _getNextStep.name;
  logger.verbose(who, 'Inside');

  var body = {
    affinityGroup: bag.affinityGroup
  };
  bag.builderApiAdapter.getNextSteps(bag.runId, body,
    function (err, result) {
      if (err) {
        logger.warn(util.format('%s, failed to get next step ' +
          'for group: %s with error: %s', bag.who, bag.affinityGroup, err));
        bag.groupComplete = true;
      } else
        bag.stepId = result.stepIds[0];

      if (!bag.stepId)
        bag.groupComplete = true;
      return next();
    }
  );
}

function _getSteplets(bag, next) {
  if (bag.groupComplete) return next();

  var who = bag.who + '|' + _getSteplets.name;
  logger.verbose(who, 'Inside');

  var query = 'stepIds=' + bag.stepId;
  bag.builderApiAdapter.getSteplets(query,
    function (err, steplets) {
      if (err)
        logger.warn(util.format('%s, failed to get steplets for ' +
          'stepId: %s with error: %s', bag.who, bag.stepId, err));
      bag.steplets = steplets;
      return next();
    }
  );
}

function _updateStepStatus(bag, next) {
  if (bag.groupComplete) return next();

  var who = bag.who + '|' + _updateStepStatus.name;
  logger.verbose(who, 'Inside');

  var update = {
    statusCode: global.systemCodesByName.queued.code
  };
  bag.builderApiAdapter.putStepById(bag.stepId, update,
    function () {
      return next();
    }
  );
}

function _updateStepletStatus(bag, next) {
  if (bag.groupComplete) return next();

  var who = bag.who + '|' + _updateStepletStatus.name;
  logger.verbose(who, 'Inside');

  var update = {
    statusCode: global.systemCodesByName.queued.code
  };
  async.eachLimit(bag.steplets, 5,
    function (steplet, done) {
      bag.builderApiAdapter.putStepletById(steplet.id, update,
        function () {
          return done();
        }
      );
    },
    function () {
      return next();
    }
  );
}
function _executeStep(bag, next) {
  if (bag.groupComplete) return next();

  var who = bag.who + '|' + _executeStep.name;
  logger.verbose(who, 'Inside');


  var batchSize = global.systemSettings &&
    global.systemSettings.jobConsoleBatchSize;
  var timeInterval = global.systemSettings &&
    global.systemSettings.jobConsoleBufferTimeIntervalInMS;
  var stepConsoleAdapter = new StepConsoleAdapter(bag.builderApiToken,
    bag.stepId, bag.steplets[0].pipelineId, batchSize, timeInterval);

  var innerBag = {
    who: bag.who,
    stepId: bag.stepId,
    clusterNodeId: bag.clusterNodeId,
    clusterNodeName: bag.clusterNodeName,
    builderApiAdapter: bag.builderApiAdapter,
    stepConsoleAdapter: stepConsoleAdapter,
    baseDir: bag.baseDir,
    execTemplatesDir: bag.execTemplatesDir,
    builderApiToken: bag.builderApiToken,
    badStatus: false,
    stepStatusPoller: bag.stepStatusPoller,
    pipelineId: bag.steplets[0].pipelineId
  };
  async.series([
      __execute.bind(null, innerBag),
    ],
    function (err) {
      if (err) {
        logger.warn(util.format('%s, ' +
          'failed to execute step %s with error: %s',
          bag.who, innerBag.stepId, err)
        );
      }
      return next();
    }
  );

}

function __execute(bag, next) {
  var who = bag.who + '|' + __execute.name;
  logger.verbose(who, 'Inside');

  executeStep(bag,
    function (err) {
      if (err)
        logger.warn(util.format('%s, step with id %s ended ' +
          'with error: %s', bag.who, bag.stepId, err));
      return next();
    }
  );
}

function __restart(bag) {
  var who = bag.who + '|' + __restart.name;
  logger.verbose(who, 'Inside');

  var restartScriptPath = path.resolve(global.config.helperScriptsDir,
    'service', 'restart', global.config.shippableNodeArchitecture,
    global.config.shippableNodeOperatingSystem,
    'restart.' + global.config.scriptExtension);

  scriptExecutor(restartScriptPath, [],
    function (err) {
      if (err)
        logger.error(
          util.format('Failed to restart service with err:%s', err)
        );
    }
  );
}
