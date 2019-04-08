'use strict';

var _ = require('underscore');
var async = require('async');
var fs = require('fs');
var path = require('path');
var poller = require('./poller.js');
var spawn = require('child_process').spawn;
var util = require('util');
var dotenv = require('dotenv');
var StepletConsolesAdapter = require('./shippable/StepletConsolesAdapter.js');
var ShippableAdapter = require('./shippable/APIAdapter.js');

module.exports = function (callback) {
  var who = util.format('%s|common|%s', global.who, 'executor');
  logger.info(who, 'Inside');

  var bag = {
    currentProcess: null,
    exitCode: 0,
    reqKickSteps: [],
    skipStatusUpdate: false,
    statusPoll: null,
    who: who,
    errors: [],
    error: false
  };

  async.series(
    [
      _readJobEnv.bind(null, bag),
      _instantiateShippableAdapter.bind(null, bag),
      _instantiateStepletConsolesAdapter.bind(null, bag),
      _getSystemCodes.bind(null, bag),
      _putStepletToProcessing.bind(null, bag),
      _pollStatus.bind(null, bag),
      _executeScript.bind(null, bag),
      _getStatus.bind(null, bag),
      _setStatus.bind(null, bag),
      _updateStepletStatus.bind(null, bag),
      _setExecutorAsReqProc.bind(null, bag),
      _pushErrorsToConsole.bind(null, bag)
    ],
    function () {
      if (bag.exitCode)
        logger.error(
          util.format('%s: Failed to process message with exit code: %s',
            who, bag.exitCode
          )
        );
      else
        logger.info(util.format('%s: Successfully processed message', who));

      callback();
    }
  );
};

function _readJobEnv(bag, next) {
  var who = bag.who + '|' + _readJobEnv.name;
  logger.verbose(who, 'Inside');

  fs.readFile(global.config.stepENVPath, 'utf8',
    function (err, data) {
      if (err) {
        logger.warn(who, 'Failed to read job ENVs: ', err);
      } else {
        bag.stepEnvs = dotenv.parse(data);
        bag.stepletId = bag.stepEnvs.STEPLET_ID;
        bag.executeScriptPath = bag.stepEnvs.SCRIPT_PATH;
        return next(err);
      }
    }
  );
}

function _instantiateShippableAdapter(bag, next) {
  var who = bag.who + '|' + _instantiateShippableAdapter.name;
  logger.verbose(who, 'Inside');

  bag.shippableAdapter = new ShippableAdapter(bag.stepEnvs.SHIPPABLE_API_URL,
    bag.stepEnvs.BUILDER_API_TOKEN);
  return next();
}

function _instantiateStepletConsolesAdapter(bag, next) {
  var who = bag.who + '|' + _instantiateStepletConsolesAdapter.name;
  logger.verbose(who, 'Inside');

  bag.consolesAdapter = new StepletConsolesAdapter(
    bag.stepEnvs.SHIPPABLE_API_URL,
    bag.stepEnvs.BUILDER_API_TOKEN,
    bag.stepEnvs.STEPLET_ID
  );
  return next();
}

function _getSystemCodes(bag, next) {
  var who = bag.who + '|' + _getSystemCodes.name;
  logger.verbose(who, 'Inside');

  bag.shippableAdapter.getSystemCodes(
    function (err, systemCodes) {
      if (err) {
        bag.error = true;
        bag.errors.push(util.format(
          '%s: Failed to get systemCodes with error: %s', who, bag.exitCode));
      } else {
        bag.systemCodesByName = _.indexBy(systemCodes, 'name');
      }

      return next();
    }
  );
}

function _putStepletToProcessing(bag, next) {
  if (bag.error) return next();

  var who = bag.who + '|' + _putStepletToProcessing.name;
  logger.verbose(who, 'Inside');

  var update = {
    statusCode: bag.systemCodesByName['processing'].code
  };
  bag.shippableAdapter.putStepletById(bag.stepletId, update,
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

function _pollStatus(bag, next) {
  if (bag.error) return next();

  var who = bag.who + '|' + _pollStatus.name;
  logger.verbose(who, 'Inside');

  var pollerOpts = {
    filePath: global.config.stepStatusPath,
    intervalMS: global.config.pollIntervalMS,
    content: ['cancelled', 'timeout']
  };

  poller(pollerOpts,
    function (err, statusPoll) {
      bag.statusPoll = statusPoll;
      if (err) {
        bag.error = true;
        bag.errors.push(
          util.format('%s: Failed to status poller with error: %s', who, err)
        );
        logger.error(
          util.format('%s: Failed to status poller with error: %s', who, err)
        );
      } else {
        statusPoll.on('match', function (status) {
          logger.verbose(util.format('%s: Received %s status', who, status));
          var msg = util.format(
            'Terminating the job because the status was: %s', status);
          bag.consolesAdapter.openGrp(msg);
          bag.consolesAdapter.closeGrp(true);
          if (bag.currentProcess) {
            __executeKillScript(bag.killScriptName,
              function (err) {
                if (err) {
                  logger.warn(
                    util.format('%s: Failed to execute container kill script ' +
                    ':  %s with error code: %s', who, bag.killScriptName, err)
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
        });
      }
      return next();
    }
  );
}

function _executeScript(bag, next) {
  if (bag.error) return next();

  var who = bag.who + '|' + _executeScript.name;
  logger.verbose(who, 'Inside');

  var executeScriptPath = bag.executeScriptPath;
  bag.killScriptName = bag.killScript || null;
  bag.currentProcess = spawn(global.config.reqExecBinPath, [
    executeScriptPath, global.config.stepENVPath
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
      bag.statusPoll.stop();
      bag.currentProcess = null;
      if (exitCode || signal) {
        bag.errors = bag.errors.concat(stdoutMsg);
        bag.exitCode = exitCode || signal;
      }
      logger.verbose(util.format('%s: Script %s exited with exit code: ' +
        '%s and signal: %s', who, executeScriptPath, exitCode, signal)
      );
      return next();
    }
  );
}

function _getStatus(bag, next) {
  var who = bag.who + '|' + _getStatus.name;
  logger.verbose(who, 'Inside');

  fs.readFile(global.config.stepStatusPath, 'utf8',
    function (err, data) {
      if (err) {
        bag.errors.push(
          util.format('%s: Failed to get status file: %s with error: %s',
            who, global.config.stepStatusPath, err
          )
        );
        logger.verbose(
          util.format('%s: Failed to get status file: %s with error: %s',
            who, global.config.stepStatusPath, err
          )
        );
      } else {
        logger.verbose(
          util.format('%s: Found status file: %s with content %s',
            who, global.config.stepStatusPath, JSON.stringify(data)
          )
        );

        // If a status has already been set due to cancel/timeout, skip
        // status update.
        if (!_.isEmpty(data)) {
          bag.skipStatusUpdate = true;
        } else {
          bag.statusName = bag.exitCode ? 'failure' : 'success';
          if (bag.error)
            bag.statusName = 'error';
        }
      }
      return next();
    }
  );
}

function _setStatus(bag, next) {
  if (bag.skipStatusUpdate) return next();

  var who = bag.who + '|' + _setStatus.name;
  logger.verbose(who, 'Inside');

  fs.writeFile(global.config.stepStatusPath, bag.statusName,
    function (err) {
      if (err) {
        bag.errors.push(
          util.format('%s: Failed to set status file: %s with error: %s',
            who, global.config.stepStatusPath, err
          )
        );
        logger.verbose(
          util.format('%s: Failed to set status file: %s with error: %s',
            who, global.config.stepStatusPath, err
          )
        );
      } else {
        logger.verbose(
          util.format('%s: Updated status file: %s with content %s',
            who, global.config.stepStatusPath, bag.statusName
          )
        );
      }
      return next();
    }
  );
}

function _updateStepletStatus(bag, next) {
  if (bag.skipStatusUpdate) return next();

  var who = bag.who + '|' + _updateStepletStatus.name;
  logger.verbose(who, 'Inside');

  var update = {
    statusCode: bag.systemCodesByName[bag.statusName].code
  };
  bag.shippableAdapter.putStepletById(bag.stepletId, update,
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

function _setExecutorAsReqProc(bag, next) {
  var who = bag.who + '|' + _setExecutorAsReqProc.name;
  logger.verbose(who, 'Inside');

  var content = 'reqProc\n';
  fs.writeFile(global.config.stepWhoPath, content,
    function (err) {
      if (err) {
        bag.error.push(
          util.format('%s: Failed to set executor file: %s with err %s',
            who, global.config.stepWhoPath, err
          )
        );
        logger.error(
          util.format('%s: Failed to set executor file: %s with err %s',
            who, global.config.stepWhoPath, err
          )
        );
      } else {
        logger.verbose(
          util.format('%s: Updated executor file: %s with content: %s',
            who, global.config.stepWhoPath, JSON.stringify(content)
          )
        );
      }
      return next();
    }
  );
}

function _pushErrorsToConsole(bag, next) {
  if (_.isEmpty(bag.errors)) return next();

  var who = bag.who + '|' + _pushErrorsToConsole.name;
  logger.verbose(who, 'Inside');

  var msg = bag.errors.join('/n');

  bag.consolesAdapter.openGrp('reqKick debug logs');
  bag.consolesAdapter.openCmd('Errors');
  bag.consolesAdapter.publishMsg(msg);
  bag.consolesAdapter.closeCmd(false);
  bag.consolesAdapter.closeGrp(false);

  return next();
}

function __executeKillScript(killScriptName, done) {
  if (_.isEmpty(killScriptName)) return done();

  var killProcess = spawn(global.config.reqExecBinPath, [
    path.join(global.config.scriptsDir, killScriptName),
    global.config.stepENVPath
  ]);

  killProcess.on('exit',
    function (exitCode, signal) {
      return done(exitCode || signal);
    }
  );
}
