'use strict';

var _ = require('underscore');
var async = require('async');
var fs = require('fs');
var path = require('path');
var poller = require('./poller.js');
var spawn = require('child_process').spawn;
var util = require('util');
var dotenv = require('dotenv');
var ConsolesAdapter = require('./shippable/ConsolesAdapter.js');

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
    errors: []
  };

  async.series(
    [
      _instantiateConsolesAdapter.bind(null, bag),
      _readStepsPath.bind(null, bag),
      _readScripts.bind(null, bag),
      _pollStatus.bind(null, bag),
      _executeSteps.bind(null, bag),
      _getStatus.bind(null, bag),
      _setStatus.bind(null, bag),
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

function _instantiateConsolesAdapter(bag, next) {
  var who = bag.who + '|' + _instantiateConsolesAdapter.name;
  logger.verbose(who, 'Inside');

  fs.readFile(global.config.jobENVPath, 'utf8',
    function (err, data) {
      if (err) {
        logger.warn(who, 'Failed to read job ENVs: ', err);
      } else {
        var envs = dotenv.parse(data);
        bag.consolesAdapter = new ConsolesAdapter(
          envs.SHIPPABLE_API_URL,
          envs.BUILDER_API_TOKEN,
          envs.BUILD_JOB_ID
        );
      }

      return next(err);
    }
  );
}

function _readStepsPath(bag, next) {
  var who = bag.who + '|' + _readStepsPath.name;
  logger.verbose(who, 'Inside');

  fs.readFile(global.config.jobStepsPath, 'utf8',
    function (err, data) {
      if (err) {
        bag.exitCode = 1;
        bag.errors.push(util.format(
          '%s: Failed to read file: %s with error: %s',
            who, global.config.jobStepsPath, bag.exitCode
          )
        );
        logger.error(
          util.format('%s: Failed to read file: %s with error: %s',
            who, global.config.jobStepsPath, bag.exitCode
          )
        );
      } else {
        bag.stepsFile = data;
      }
      return next();
    }
  );
}

function _readScripts(bag, next) {
  if (bag.exitCode) return next();

  var who = bag.who + '|' + _readScripts.name;
  logger.verbose(who, 'Inside');

  fs.readFile(path.join(global.config.statusDir,bag.stepsFile), 'utf8',
    function (err, data) {
      if (err) {
        bag.exitCode = 1;
        bag.errors.push(
          util.format('%s: Failed to read file: %s with error: %s',
            who, bag.stepsFile, bag.exitCode
          )
        );
        logger.error(
          util.format('%s: Failed to read file: %s with error: %s',
            who, bag.stepsFile, bag.exitCode
          )
        );
      } else {
        try {
          bag.reqKickSteps = JSON.parse(data).reqKick;
          logger.verbose(
            util.format('%s: Parsed file: %s successfully', who, bag.stepsFile)
          );
        } catch (err) {
          bag.exitCode = 1;
          bag.errors.push(
            util.format('%s: Failed to parse JSON file: %s with error: %s',
              who, bag.stepsFile, err
            )
          );
          logger.error(
            util.format('%s: Failed to parse JSON file: %s with error: %s',
              who, bag.stepsFile, err
            )
          );
        }
      }
      return next();
    }
  );
}

function _pollStatus(bag, next) {
  if (bag.exitCode) return next();

  var who = bag.who + '|' + _pollStatus.name;
  logger.verbose(who, 'Inside');

  var pollerOpts = {
    filePath: global.config.jobStatusPath,
    intervalMS: global.config.pollIntervalMS,
    content: ['cancelled', 'timeout']
  };

  poller(pollerOpts,
    function (err, statusPoll) {
      bag.statusPoll = statusPoll;
      if (err) {
        bag.exitCode = 1;
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

function _executeSteps(bag, next) {
  if (bag.exitCode) return next();

  var who = bag.who + '|' + _executeSteps.name;
  logger.verbose(who, 'Inside');

  async.eachSeries(
    bag.reqKickSteps,
    function (step, nextStep) {
      var taskScriptName = step.taskScript;
      bag.killScriptName = step.killScript || null;
      bag.currentProcess = spawn(global.config.reqExecBinPath, [
        path.join(global.config.scriptsDir, taskScriptName),
        global.config.jobENVPath
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
          if (exitCode || signal)
            bag.errors = bag.errors.concat(stdoutMsg);
          logger.verbose(util.format('%s: Script %s exited with exit code: ' +
            '%s and signal: %s', who, taskScriptName, exitCode, signal)
          );
          return nextStep(exitCode || signal);
        }
      );
    },
    function (err) {
      // The task has completed at this point, we don't want the status poller
      // to run anymore.
      bag.statusPoll.stop();
      if (err)
        bag.exitCode = 1;
      return next();
    }
  );
}

function _getStatus(bag, next) {
  var who = bag.who + '|' + _getStatus.name;
  logger.verbose(who, 'Inside');

  fs.readFile(global.config.jobStatusPath, 'utf8',
    function (err, data) {
      if (err) {
        bag.errors.push(
          util.format('%s: Failed to get status file: %s with error: %s',
            who, global.config.jobStatusPath, err
          )
        );
        logger.verbose(
          util.format('%s: Failed to get status file: %s with error: %s',
            who, global.config.jobStatusPath, err
          )
        );
      } else {
        logger.verbose(
          util.format('%s: Found status file: %s with content %s',
            who, global.config.jobStatusPath, JSON.stringify(data)
          )
        );

        // If a status has already been set due to cancel/timeout, skip
        // status update.
        if (!_.isEmpty(data))
          bag.skipStatusUpdate = true;
      }
      return next();
    }
  );
}

function _setStatus(bag, next) {
  if (bag.skipStatusUpdate) return next();

  var who = bag.who + '|' + _setStatus.name;
  logger.verbose(who, 'Inside');

  var errorCode = bag.exitCode ? 'failure' : 'success';
  fs.writeFile(global.config.jobStatusPath, errorCode,
    function (err) {
      if (err) {
        bag.errors.push(
          util.format('%s: Failed to set status file: %s with error: %s',
            who, global.config.jobStatusPath, err
          )
        );
        logger.verbose(
          util.format('%s: Failed to set status file: %s with error: %s',
            who, global.config.jobStatusPath, err
          )
        );
      } else {
        logger.verbose(
          util.format('%s: Updated status file: %s with content %s',
            who, global.config.jobStatusPath, errorCode
          )
        );
      }
      return next();
    }
  );
}

function _setExecutorAsReqProc(bag, next) {
  var who = bag.who + '|' + _setExecutorAsReqProc.name;
  logger.verbose(who, 'Inside');

  var content = 'reqProc\n';
  fs.writeFile(global.config.jobWhoPath, content,
    function (err) {
      if (err) {
        bag.error.push(
          util.format('%s: Failed to set executor file: %s with err %s',
            who, global.config.jobWhoPath, err
          )
        );
        logger.error(
          util.format('%s: Failed to set executor file: %s with err %s',
            who, global.config.jobWhoPath, err
          )
        );
      } else {
        logger.verbose(
          util.format('%s: Updated executor file: %s with content: %s',
            who, global.config.jobWhoPath, JSON.stringify(content)
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
    global.config.jobENVPath
  ]);

  killProcess.on('exit',
    function (exitCode, signal) {
      return done(exitCode || signal);
    }
  );
}
