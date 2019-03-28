'use strict';

var _ = require('underscore');
var path = require('path');
var util = require('util');
var postNodeStats = require('./common/healthChecks/postNodeStats.js');
var worker = require('./worker.js');

function setupGlobals() {
  global.who = 'reqKick|reqKick.app.js';
  global.logger = require('./common/logger.js')();

  var runMode = process.env.RUN_MODE;
  // default log level is warn
  var logLevel = 'warn';

  if (runMode === 'dev')
    logLevel = 'debug';
  else if (runMode === 'beta')
    logLevel = 'verbose';
  else if (runMode === 'production')
    logLevel = 'warn';

  logger.level = logLevel;
}

function checkENVs() {
  var who = global.who + '|' + checkENVs.name;
  logger.info(who, 'Inside');

  var expectedENVs = ['STATUS_DIR', 'SCRIPTS_DIR', 'REQEXEC_BIN_PATH',
  'NODE_ID', 'NODE_TYPE_CODE', 'SHIPPABLE_NODE_ARCHITECTURE',
  'SHIPPABLE_NODE_OPERATING_SYSTEM', 'SHIPPABLE_API_URL'];

  var errors = [];
  _.each(expectedENVs,
    function (expectedENV) {
      if (_.isEmpty(process.env[expectedENV]))
        errors.push(
          util.format('%s: Missing ENV: %s', global.who, expectedENV)
        );
    }
  );

  if (!_.isEmpty(errors)) {
    _.each(errors,
      function (error) {
        logger.error(error);
      }
    );
    process.exit(1);
  }
}

function setupConfig() {
  var who = global.who + '|' + setupConfig.name;
  logger.info(who, 'Inside');

  global.config = {
    statusDir: process.env.STATUS_DIR,
    scriptsDir: process.env.SCRIPTS_DIR,
    reqExecBinPath: process.env.REQEXEC_BIN_PATH,
    nodeId: process.env.NODE_ID,
    subscriptionId: process.env.SUBSCRIPTION_ID,
    nodeTypeCode: parseInt(process.env.NODE_TYPE_CODE, 10) || 7001,
    shippableNodeArchitecture: process.env.SHIPPABLE_NODE_ARCHITECTURE,
    shippableNodeOperatingSystem: process.env.SHIPPABLE_NODE_OPERATING_SYSTEM,
    pollIntervalMS: 5000
  };

  global.config.jobWhoPath = path.join(global.config.statusDir, 'job.who');
  global.config.jobStatusPath = path.join(
    global.config.statusDir,
    'job.status'
  );
  global.config.jobENVPath = path.join(global.config.statusDir, 'job.env');
  global.config.jobStepsPath = path.join(
    global.config.statusDir,
    'job.steps.path'
  );

  global.config.apiUrl = process.env.SHIPPABLE_API_URL;

  if (global.config.shippableNodeOperatingSystem === 'WindowsServer_2016') {
    global.config.scriptExtension = 'ps1';
    global.config.defaultShell = 'powershell';
    global.config.defaultShellArgs = [];
  } else {
    global.config.scriptExtension = 'sh';
    global.config.defaultShell = '/bin/bash';
    global.config.defaultShellArgs = ['-c'];
  }

  /* Node Type Codes */
  global.nodeTypeCodes = {
    dynamic: 7000,
    custom: 7001,
    system: 7002,
    service: 7003
  };

  global.config.isSystemNode =
    global.config.nodeTypeCode === global.nodeTypeCodes.system;
}

function reqKick() {
  setupGlobals();
  checkENVs();
  setupConfig();
  postNodeStats();
  worker();
}

reqKick();
