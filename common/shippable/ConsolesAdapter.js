'use strict';

var self = ConsolesAdapter;
module.exports = self;

var _ = require('underscore');
var util = require('util');
var uuid = require('node-uuid');
var APIAdapter = require('./APIAdapter.js');

function ConsolesAdapter(apiUrl, apiToken, buildJobId, jobConsoleBatchSize,
  jobConsoleBufferTimeInterval) {
  this.who = util.format('%s|ConsolesAdapter|jobId:%s', global.who, buildJobId);
  this.buildJobId = buildJobId;

  this.startTimeInMicroSec = new Date().getTime() * 1000;
  var processStartTime = process.hrtime();
  this.processStartTimeInMicroSec =
    processStartTime[0] * 1e6 + processStartTime[1] / 1e3;
  this.APIAdapter = new APIAdapter(apiUrl, apiToken);
  this.batchSize = jobConsoleBatchSize || 20;
  this.buffer = [];
  this.bufferTimeInterval = jobConsoleBufferTimeInterval || 3000;
  this.bufferTimer = null;
  this.pendingApiCalls = 0;
}

ConsolesAdapter.prototype.openGrp = function (consoleGrpName) {
  var that = this;
  that.consoleGrpName = consoleGrpName;
  that.consoleGrpId = uuid.v4();

  var consoleGrp = {
    buildJobId: that.buildJobId,
    consoleId: that.consoleGrpId,
    parentConsoleId: 'root',
    type: 'grp',
    message: that.consoleGrpName,
    timestamp: that._getTimestamp(),
    isShown: true
  };

  that.buffer.push(consoleGrp);
  that._postToBuildJobConsole(true);
};

ConsolesAdapter.prototype.closeGrp = function (isSuccess) {
  var that = this;
  // The grp is already closed
  if (!that.consoleGrpName)
    return;

  if (!_.isBoolean(isSuccess)) isSuccess = true;

  that.closeCmd();

  var consoleGrp = {
    buildJobId: that.buildJobId,
    consoleId: that.consoleGrpId,
    parentConsoleId: 'root',
    type: 'grp',
    message: that.consoleGrpName,
    timestamp: that._getTimestamp(),
    timestampEndedAt: that._getTimestamp(),
    isSuccess: isSuccess,
    isShown: true
  };

  that.buffer.push(consoleGrp);
  that._postToBuildJobConsole(true);
  that.consoleGrpName = null;
  that.consoleGrpId = null;
};

ConsolesAdapter.prototype.openCmd = function (consoleCmdName) {
  var that = this;

  that.consoleCmdName = consoleCmdName;
  that.consoleCmdId = uuid.v4();

  var consoleGrp = {
    buildJobId: that.buildJobId,
    consoleId: that.consoleCmdId,
    parentConsoleId: that.consoleGrpId,
    type: 'cmd',
    message: that.consoleCmdName,
    timestamp: that._getTimestamp(),
    isShown: true
  };

  that.buffer.push(consoleGrp);
  that._postToBuildJobConsole(true);
};

ConsolesAdapter.prototype.closeCmd = function (isSuccess) {
  var that = this;

  //The cmd is already closed
  if (!that.consoleCmdName)
    return;

  if (!_.isBoolean(isSuccess)) isSuccess = true;

  var consoleGrp = {
    buildJobId: that.buildJobId,
    consoleId: that.consoleCmdId,
    parentConsoleId: that.consoleGrpId,
    type: 'cmd',
    message: that.consoleCmdName,
    timestamp: that._getTimestamp(),
    timestampEndedAt: that._getTimestamp(),
    isSuccess: isSuccess,
    isShown: false
  };

  that.buffer.push(consoleGrp);
  that._postToBuildJobConsole(true);
  that.consoleCmdName = null;
  that.consoleCmdId = null;
};

ConsolesAdapter.prototype.publishMsg = function (message) {
  var that = this;

  var consoleGrp = {
    buildJobId: that.buildJobId,
    consoleId: uuid.v4(),
    parentConsoleId: that.consoleCmdId,
    type: 'msg',
    message: message,
    timestamp: that._getTimestamp(),
    isShown: true
  };

  that.buffer.push(consoleGrp);
  that._postToBuildJobConsole(false);
};

ConsolesAdapter.prototype._postToBuildJobConsole = function (forced) {
  var that = this;
  var who = that.who + '|_postToBuildJobConsole';

  if (that.buffer.length > that.batchSize || forced) {
    if (that.bufferTimer) {
      // If a timeout has been set for the buffer, clear it.
      clearTimeout(that.bufferTimer);
      that.bufferTimer = null;
    }

    var consoles = that.buffer.splice(0, that.buffer.length);

    if (consoles.length === 0)
      return;

    var body = {
      buildJobId: that.buildJobId,
      buildJobConsoles: consoles
    };

    that.pendingApiCalls ++;
    that.APIAdapter.postBuildJobConsoles(body,
      function (err) {
        that.pendingApiCalls --;
        if (err)
          logger.error(who, 'postBuildJobConsoles Failed', err);
        logger.debug(who, 'Succeeded');
      }
    );
  } else if (!that.bufferTimer) {
    // Set a timeout that will clear the buffer in three seconds if nothing has.
    that.bufferTimer = setTimeout(
      function () {
        this._postToBuildJobConsole(true);
      }.bind(that),
      that.bufferTimeInterval);
  }
};

ConsolesAdapter.prototype.getPendingApiCallCount = function() {
  var that = this;
  return that.pendingApiCalls;
};

ConsolesAdapter.prototype._getTimestamp = function () {
  var that = this;
  var currentProcessTime = process.hrtime();

  return that.startTimeInMicroSec +
    (currentProcessTime[0] * 1e6 + currentProcessTime[1]/1e3) -
      that.processStartTimeInMicroSec;
};
