'use strict';

global.name = 'reqKick';
global.util = require('util');
global._ = require('underscore');
global.async = require('async');
var path = require('path');

var BuildAgent = require('./init/BuildAgent.js');

function setupGlobals() {
  global.who = 'reqKick|reqKick.app.js';
  global.logger = require('./helpers/utilities/logger.js')();

  var runMode = process.env.RUN_MODE;
  // default log level is warn
  var logLevel = 'warn';

  if (runMode === 'devmode')
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

  var expectedENVs = [
    'REQEXEC_BIN_PATH',
    'NODE_ID',
    'PROJECT_ID',
    'SHIPPABLE_NODE_ARCHITECTURE',
    'SHIPPABLE_NODE_OPERATING_SYSTEM',
    'SHIPPABLE_API_URL',
    'LISTEN_QUEUE',
    'SHIPPABLE_AMQP_URL',
    'SHIPPABLE_WWW_URL',
    'BASE_DIR',
    'EXECTEMPLATES_DIR',
    'SHIPPABLE_RUNTIME_VERSION',
    'SHIPPABLE_RELEASE_VERSION',
    'RUN_MODE'
  ];

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
    reqExecBinPath: process.env.REQEXEC_BIN_PATH,
    nodeId: process.env.NODE_ID,
    projectId: process.env.PROJECT_ID,
    shippableNodeArchitecture: process.env.SHIPPABLE_NODE_ARCHITECTURE,
    shippableNodeOperatingSystem: process.env.SHIPPABLE_NODE_OPERATING_SYSTEM,
    execTemplatesDir: process.env.EXECTEMPLATES_DIR,
    amqpExchange: 'shippableEx',
    apiUrl: process.env.SHIPPABLE_API_URL,
    wwwUrl: process.env.SHIPPABLE_WWW_URL,
    inputQueue: process.env.LISTEN_QUEUE,
    amqpUrl: process.env.SHIPPABLE_AMQP_URL,
    baseDir: process.env.BASE_DIR,
    reqExecDir: process.env.REQEXEC_DIR,
    reqExecCommand: process.env.TASK_CONTAINER_COMMAND,
    stepStatusPollIntervalMS: 15 * 1000,
    shippableRuntimeVersion: process.env.SHIPPABLE_RUNTIME_VERSION,
    shippableReleaseVersion: process.env.SHIPPABLE_RELEASE_VERSION,
    agentVersion: process.env.SHIPPABLE_RELEASE_VERSION,
    isProcessingStep: false,
    runMode: process.env.RUN_MODE
  };

  if (global.config.shippableNodeOperatingSystem === 'WindowsServer_2016') {
    global.config.scriptExtension = 'ps1';
    global.config.defaultShell = 'powershell';
    global.config.defaultShellArgs = [];
  } else {
    global.config.scriptExtension = 'sh';
    global.config.defaultShell = '/bin/bash';
    global.config.defaultShellArgs = ['-c'];
  }

  global.config.helperScriptsDir = path.resolve(__dirname, './helpers/scripts');
  global.config.helperTemplatesDir =
    path.resolve(__dirname, './helpers/templates');
}

function reqKick() {
  setupGlobals();
  checkENVs();
  setupConfig();

  var buildAgent = new BuildAgent();
  // This is where the buildAgent starts
  buildAgent.init();
}

reqKick();
