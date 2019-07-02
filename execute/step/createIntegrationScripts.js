'use strict';

var self = assembleIntegrationScripts;
module.exports = self;

var path = require('path');
var fs = require('fs');

function assembleIntegrationScripts(externalBag, callback) {
  var bag = {
    stepData: externalBag.stepData,
    runStepConnections: externalBag.runStepConnections,
    stepConsoleAdapter: externalBag.stepConsoleAdapter,
    execTemplatesDir: externalBag.execTemplatesDir,
    error: false
  };
  bag.who = util.format('%s|execute|step|%s', name, self.name);
  logger.info(bag.who, 'Inside');

  async.series([
      _checkInputParams.bind(null, bag),
      _assembleIntegrationScripts.bind(null, bag),
      _addIntegrationScriptsToStep.bind(null, bag)
    ],
    function (err) {
      if (err)
        logger.error(bag.who, 'Failed to assemble integration scripts');
      else
        logger.info(bag.who, 'Successfully assembled integration scripts');

      var result = {
        stepData: bag.stepData
      };
      return callback(err, result);
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  var expectedParams = [
    'execTemplatesDir',
    'stepData',
    'runStepConnections',
    'stepConsoleAdapter'
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
  if (hasErrors) {
    logger.error(paramErrors.join('\n'));
    return next(hasErrors);
  }

  return next();
}

function _assembleIntegrationScripts(bag, next) {
  var who = bag.who + '|' + _assembleIntegrationScripts.name;
  logger.verbose(who, 'Inside');

  var error = false;
  bag.setupScripts = [];
  bag.cleanupScripts = [];

  var integrationNames = _.compact(_.pluck(bag.runStepConnections,
    'operationIntegrationName'));

  var integrationsByName = _.indexBy(bag.stepData.integrations, 'name');

  bag.stepConsoleAdapter.openCmd('Assembling scripts for integrations');

  _.each(integrationNames,
    function (integrationName) {
      var integration = integrationsByName[integrationName];

      if (!integration) {
        bag.stepConsoleAdapter.publishMsg(
          util.format('Missing integration: %s', integrationName)
        );
        return;
      }

      var masterIntegrationName = integration.masterName;
      var setupTemplateScript;
      var cleanupTemplateScript;

      var integrationTemplatesPath = path.join(bag.execTemplatesDir,
        'integrations', masterIntegrationName);
      var setupTemplatePath = path.join(integrationTemplatesPath,
        'configure.sh');
      var cleanupTemplatePath = path.join(integrationTemplatesPath,
        'cleanup.sh');
      try {
        setupTemplateScript = fs.readFileSync(setupTemplatePath,
          'utf8').toString();
      } catch (e) {
        logger.debug(util.inspect(e));
      }
      try {
        cleanupTemplateScript = fs.readFileSync(cleanupTemplatePath,
          'utf8').toString();
      } catch (e) {
        logger.debug(util.inspect(e));
      }
      if (_.isEmpty(setupTemplateScript) || _.isEmpty(cleanupTemplateScript))
        return;

      var err = false;
      var setupTemplate = _.template(setupTemplateScript);
      var cleanupTemplate = _.template(cleanupTemplateScript);
      try {
        bag.setupScripts.push(setupTemplate({ 'context': integration }));
        bag.cleanupScripts.push(cleanupTemplate({ 'context': integration }));
      } catch (e) {
        err = true;
        error = true;
        logger.error(util.inspect(e));
      }
      if (err)
        bag.stepConsoleAdapter.publishMsg(
          util.format('Failed to create scripts for integration: %s',
          integration.name)
        );
      else
        bag.stepConsoleAdapter.publishMsg(
          util.format('Successfully created scripts for integration: %s',
          integration.name)
        );
    }
  );

  if (error) {
    bag.stepConsoleAdapter.closeCmd(false);
    return next(true);
  }
  bag.stepConsoleAdapter.closeCmd(true);
  return next();
}

function _addIntegrationScriptsToStep(bag, next) {
  var who = bag.who + '|' + _addIntegrationScriptsToStep.name;
  logger.verbose(who, 'Inside');

  var step = bag.stepData.step || {};
  step.execution = step.execution || {};
  if (!_.isEmpty(bag.setupScripts)) {
    step.execution.dependsOn = step.execution.dependsOn || [];
    step.execution.dependsOn =
      step.execution.dependsOn.concat(bag.setupScripts);
  }

  if (!_.isEmpty(bag.cleanupScripts))
    step.execution.cleanupIntegrations = bag.cleanupScripts;

  bag.stepData.step = step;
  return next();
}
