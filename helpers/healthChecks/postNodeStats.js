'use strict';
var self = postNodeStats;
module.exports = self;

var exec = require('child_process').exec;
var ShippableAdapter = require('../shippable/APIAdapter.js');
var STATS_PERIOD = 10 * 1000; // 10 seconds
var os = require('os');
var path = require('path');
var _ = require('underscore');
var async = require('async');
var util = require('util');

var healthChecksScriptsDirPath = ('../scripts/healthChecks');

function postNodeStats(callback) {
  var bag = {
    adapter: new ShippableAdapter(''),
    stopStatsPosting: false
  };

  bag.who = util.format('%s|helpers|healthChecks|%s', global.who, self.name);
  logger.verbose('Posting node stats of nodeId: %s', global.config.nodeId);

  async.series([
      _checkActiveContainers.bind(null, bag),
      _checkTotalContainers.bind(null, bag),
      _checkImageCount.bind(null, bag),
      _checkMemoryUsage.bind(null, bag),
      _checkCpuUsage.bind(null, bag),
      _checkDiskUsage.bind(null, bag),
      _postClusterNodeStat.bind(null, bag)
    ],
    function (err) {
      if (err)
        logger.error(bag.who,
          util.format('Failed to post node stats with error: %s', err));
      else
        logger.verbose(bag.who, 'Successfully posted node stats');

      if (!bag.stopStatsPosting) {
        logger.debug(util.format('Sleeping for %d seconds before POSTing ' +
          'clusterNodeStats', STATS_PERIOD/1000));
        setTimeout(postNodeStats, STATS_PERIOD);
      }

      if (callback)
        return callback();
    }
  );
}

function _checkActiveContainers(bag, next) {
  var who = bag.who + '|' + _checkActiveContainers.name;
  logger.debug(who, 'Inside');

  var scriptPath = util.format('%s/%s/activeContainerCount.%s',
    global.config.shippableNodeArchitecture,
    global.config.shippableNodeOperatingSystem,
    global.config.scriptExtension);
  scriptPath = path.resolve(__dirname, healthChecksScriptsDirPath, scriptPath);

  var command = util.format('%s %s %s', global.config.defaultShell,
    global.config.defaultShellArgs.join(' '), scriptPath);
  exec(command,
    function (err, stdout) {
      if (err)
        return next(err);
      bag.activeContainersCount = parseInt(stdout) - 1;
      return next();
    }
  );
}

function _checkTotalContainers(bag, next) {
  var who = bag.who + '|' + _checkTotalContainers.name;
  logger.debug(who, 'Inside');

  var scriptPath = util.format('%s/%s/totalContainerCount.%s',
    global.config.shippableNodeArchitecture,
    global.config.shippableNodeOperatingSystem,
    global.config.scriptExtension);
  scriptPath = path.resolve(__dirname, healthChecksScriptsDirPath, scriptPath);

  var command = util.format('%s %s %s', global.config.defaultShell,
    global.config.defaultShellArgs.join(' '), scriptPath);
  exec(command,
    function (err, stdout) {
      if (err)
        return next(err);
      bag.totalContainersCount = parseInt(stdout) - 1;
      return next();
    }
  );
}

function _checkImageCount(bag, next) {
  var who = bag.who + '|' + _checkImageCount.name;
  logger.debug(who, 'Inside');

  var scriptPath = util.format('%s/%s/imageCount.%s',
    global.config.shippableNodeArchitecture,
    global.config.shippableNodeOperatingSystem,
    global.config.scriptExtension);
  scriptPath = path.resolve(__dirname, healthChecksScriptsDirPath, scriptPath);

  var command = util.format('%s %s %s', global.config.defaultShell,
    global.config.defaultShellArgs.join(' '), scriptPath);
  exec(command,
    function (err, stdout) {
      if (err)
        return next(err);

      bag.imageCount = parseInt(stdout);
      return next();
    }
  );
}

function _checkMemoryUsage(bag, next) {
  var who = bag.who + '|' + _checkMemoryUsage.name;
  logger.debug(who, 'Inside');

  var totalMem = os.totalmem();
  var freeMem = os.freemem();

  bag.memoryUsageInPercentage = (totalMem - freeMem) * 100 / totalMem;
  return next();
}

function _checkCpuUsage(bag, next) {
  var who = bag.who + '|' + _checkCpuUsage.name;
  logger.debug(who, 'Inside');

  bag.cpuLoadInPercentage = (_.first(os.loadavg())/os.cpus().length) * 100;
  return next();
}

function _checkDiskUsage(bag, next) {
  var who = bag.who + '|' + _checkDiskUsage.name;
  logger.debug(who, 'Inside');

  var scriptPath = util.format('%s/%s/diskUsage.%s',
    global.config.shippableNodeArchitecture,
    global.config.shippableNodeOperatingSystem,
    global.config.scriptExtension);
  scriptPath = path.resolve(__dirname, healthChecksScriptsDirPath, scriptPath);

  var command = util.format('%s %s %s', global.config.defaultShell,
    global.config.defaultShellArgs.join(' '), scriptPath);
  exec(command,
    function (err, stdout) {
      if (err)
        return next(err);

      bag.diskUsageInPercentage = parseInt(stdout);
      return next();
    }
  );
}

function _postClusterNodeStat(bag, next) {
  var who = bag.who + '|' + _postClusterNodeStat.name;
  logger.debug(who, 'Inside');

  var clusterNodeStat = {
    projectId: global.config.projectId,
    activeContainersCount: bag.activeContainersCount,
    totalContainersCount: bag.totalContainersCount,
    imageCount: bag.imageCount,
    memoryUsageInPercentage: bag.memoryUsageInPercentage,
    cpuLoadInPercentage: bag.cpuLoadInPercentage,
    diskUsageInPercentage: bag.diskUsageInPercentage,
    clusterNodeId: global.config.nodeId,
    reportedAt: Date.now()
  };

  bag.adapter.postClusterNodeStats(clusterNodeStat,
    function (err, clusterNodeStat, response) {
      if (err) {
        // Stop posting ClusterNodeStats if the clusterNode is not found.
        if (response && (response.statusCode === 404))
          bag.stopStatsPosting = true;
        return next(err);
      }

      return next();
    }
  );
}
