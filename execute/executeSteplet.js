'use strict';

var self = executeSteplet;
module.exports = self;

var spawn = require('child_process').spawn;
var path = require('path');

var StepletConsoleAdapter =
  require('../helpers/shippable/StepletConsoleAdapter.js');
var scriptExecutor = require('../helpers/utilities/ScriptExecutor.js');

function executeSteplet(externalBag, callback) {
  var bag = {
    currentProcess: null,
    exitCode: 0,
    skipStatusUpdate: false,
    statusPoll: null,
    errors: [],
    error: false,
    stepId: externalBag.stepId,
    stepletId: externalBag.stepletId,
    stepletScriptPath: externalBag.stepletScriptPath,
    builderApiAdapter: externalBag.builderApiAdapter,
    builderApiToken: externalBag.builderApiToken,
    pipelineId: externalBag.pipelineId,
    stepletEnvPath: externalBag.stepletEnvPath,
    statusCode: null,
    stepStatusPoller: externalBag.stepStatusPoller,
    stepDockerContainerName: externalBag.stepDockerContainerName
  };

  bag.who = util.format('%s|execute|%s', name, self.name);
  logger.info(bag.who, 'Inside');

  async.series([
      _checkInputParams.bind(null, bag),
      _instantiateStepletConsolesAdapter.bind(null, bag),
      _putStepletToProcessing.bind(null, bag),
      _watchStepStatus.bind(null, bag),
      _executeScript.bind(null, bag),
      _updateStepletStatus.bind(null, bag),
      _setTerminatingStatus.bind(null, bag),
      _pushErrorsToConsole.bind(null, bag)
    ],
    function (err) {
      if (err)
        logger.error(bag.who, util.format('Failed to execute steplet: %s',
          bag.step && bag.step.id));
      else
        logger.info(bag.who, util.format('Successfully executed steplet'));

      var resultBag = {
        statusName: global.systemCodesByCode[bag.statusCode].name
      };
      return callback(err, resultBag);
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  var expectedParams = [
    'stepId',
    'stepletId',
    'builderApiAdapter',
    'builderApiToken',
    'pipelineId',
    'stepletScriptPath',
    'stepletEnvPath',
    'stepStatusPoller',
    'stepDockerContainerName'
  ];

  var paramErrors = [];
  _.each(expectedParams,
    function (expectedParam) {
      if (_.isNull(bag[expectedParam]) || _.isUndefined(bag[expectedParam]))
        paramErrors.push(
          util.format('%s: missing param :%s', who, expectedParam)
        );
    }
  );

  var hasErrors = !_.isEmpty(paramErrors);
  if (hasErrors)
    logger.error(paramErrors.join('\n'));

  return next(hasErrors);
}


function _instantiateStepletConsolesAdapter(bag, next) {
  var who = bag.who + '|' + _instantiateStepletConsolesAdapter.name;
  logger.verbose(who, 'Inside');

  var batchSize = global.systemSettings &&
    global.systemSettings.jobConsoleBatchSize;
  var timeInterval = global.systemSettings &&
    global.systemSettings.jobConsoleBufferTimeIntervalInMS;
  bag.stepletConsoleAdapter = new StepletConsoleAdapter(bag.builderApiToken,
    bag.stepletId, bag.pipelineId, batchSize, timeInterval);

  return next();
}

function _putStepletToProcessing(bag, next) {
  var who = bag.who + '|' + _putStepletToProcessing.name;
  logger.verbose(who, 'Inside');

  var update = {
    statusCode: global.systemCodesByName.processing.code,
    startedAt: new Date()
  };
  bag.builderApiAdapter.putStepletById(bag.stepletId, update,
    function (err) {
      if (err) {
        bag.error = true;
        bag.errors.push(util.format(
          '%s: Failed to update steplet: %s with error: %s', who, bag.stepletId,
            err
          )
        );
      }
      return next();
    }
  );
}

function _watchStepStatus(bag, next) {
  var who = bag.who + '|' + _executeScript.name;
  logger.verbose(who, 'Inside');

  var eventEmitter = bag.stepStatusPoller.getEventEmitter();
  var terminatingSteps = [];
  eventEmitter.on('terminating',
    function () {
      logger.verbose(who, 'Received terminating event');
      terminatingSteps = bag.stepStatusPoller.getTerminatingSteps();
      if (_.contains(terminatingSteps.cancelling, bag.stepId) ||
        _.contains(terminatingSteps.timingOut, bag.stepId)) {
        logger.verbose(who, util.format('Step %s terminating', bag.stepId));
        bag.skipStatusUpdate = true;
        if (bag.currentProcess) {
          var killContainerScriptPath = path.resolve(
            global.config.helperScriptsDir,
            'utilities', 'killContainer.' + global.config.scriptExtension);

          scriptExecutor(killContainerScriptPath,
            [ bag.stepDockerContainerName ],
            function (err) {
              if (err) {
                logger.warn(
                  util.format('%s: Failed to execute container kill script ' +
                  ':  %s with error code: %s', who, killContainerScriptPath,
                  err)
                );
              } else {
                try {
                  bag.currentProcess.kill();
                } catch (err) {
                  logger.warn(
                    util.format('%s: Failed to kill process with pid: %s' +
                    ' with error: %s', who, bag.currentProcess.pid, err)
                  );
                }
              }
            }
          );
        }
      }
    }
  );

  terminatingSteps = bag.stepStatusPoller.getTerminatingSteps();
  if (_.contains(terminatingSteps.cancelling, bag.stepId) ||
    _.contains(terminatingSteps.timingOut, bag.stepId))
    bag.skipStatusUpdate = true;

  return next();
}

function _executeScript(bag, next) {
  if (bag.error) return next();
  if (bag.skipStatusUpdate) return next();

  var who = bag.who + '|' + _executeScript.name;
  logger.verbose(who, 'Inside');

  bag.currentProcess = spawn(global.config.reqExecBinPath, [
    bag.stepletScriptPath, bag.stepletEnvPath
  ]);

  var stdoutMsg = [];
  bag.currentProcess.stdout.on('data',
    function (data) {
      stdoutMsg.push(util.format('%s: failed to execute steps: %s',
          who, data.toString()
        )
      );
    }
  );

  bag.currentProcess.stderr.on('data',
    function (data) {
      bag.errors.push(util.format('%s: failed to execute steps: %s',
          who, data.toString()
        )
      );
    }
  );

  bag.currentProcess.on('exit',
    function (exitCode, signal) {
      bag.currentProcess = null;
      if (exitCode || signal) {
        bag.errors = bag.errors.concat(stdoutMsg);
        bag.exitCode = exitCode || signal;
      }
      logger.verbose(util.format('%s: Script %s exited with exit code: ' +
        '%s and signal: %s', who, bag.stepletScriptPath, exitCode, signal)
      );
      return next();
    }
  );
}

function _updateStepletStatus(bag, next) {
  if (bag.skipStatusUpdate) return next();

  var who = bag.who + '|' + _updateStepletStatus.name;
  logger.verbose(who, 'Inside');

  if (bag.error)
    bag.statusCode = global.systemCodesByName.error.code;
  else if (bag.exitCode === 0)
    bag.statusCode = global.systemCodesByName.success.code;
  else if (bag.exitCode === 199)
    bag.statusCode = global.systemCodesByName.error.code;
  else
    bag.statusCode = global.systemCodesByName.failure.code;

  var update = {
    statusCode: bag.statusCode,
    endedAt: new Date()
  };
  bag.builderApiAdapter.putStepletById(bag.stepletId, update,
    function (err) {
      if (err)
        bag.errors.push(util.format(
          '%s: Failed to update steplet: %s with error: %s', who, bag.stepletId,
            err
          )
        );
      return next();
    }
  );
}

function _setTerminatingStatus(bag, next) {
  if (!bag.skipStatusUpdate) return next();

  var who = bag.who + '|' + _setTerminatingStatus.name;
  logger.verbose(who, 'Inside');

  var terminatingSteps = bag.stepStatusPoller.getTerminatingSteps();
  if (_.contains(terminatingSteps.cancelling, bag.stepId))
    bag.statusCode = global.systemCodesByName.cancelling.code;

  if (_.contains(terminatingSteps.timingOut, bag.stepId))
    bag.statusCode = global.systemCodesByName.timingOut.code;

  return next();
}

function _pushErrorsToConsole(bag, next) {
  if (_.isEmpty(bag.errors)) return next();

  var who = bag.who + '|' + _pushErrorsToConsole.name;
  logger.verbose(who, 'Inside');

  var msg = bag.errors.join('/n');

  bag.stepletConsoleAdapter.openGrp('debug logs');
  bag.stepletConsoleAdapter.openCmd('Errors');
  bag.stepletConsoleAdapter.publishMsg(msg);
  bag.stepletConsoleAdapter.closeCmd(false);
  bag.stepletConsoleAdapter.closeGrp(false);

  return next();
}
