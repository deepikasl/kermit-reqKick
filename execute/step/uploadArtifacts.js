'use strict';

var self = uploadArtifacts;
module.exports = self;

var path = require('path');
var isFile = require('../../helpers/utilities/isFile.js');

var upload = require('./handlers/upload.js');

function uploadArtifacts(externalBag, callback) {
  var bag = {
    stepData: externalBag.stepData,
    stepWorkspacePath: externalBag.stepWorkspacePath,
    runWorkspacePath: externalBag.runWorkspacePath,
    pipelineWorkspacePath: externalBag.pipelineWorkspacePath,
    stepConsoleAdapter: externalBag.stepConsoleAdapter,
    builderApiAdapter: externalBag.builderApiAdapter,
    isGrpSuccess: true
  };

  bag.stepConsoleAdapter.openCmd('Uploading archive for ' +
    (bag.stepData && bag.stepData.step && bag.stepData.step.name));
  bag.who = util.format('%s|execute|step|%s', name, self.name);
  logger.info(bag.who, 'Inside');

  async.series([
      _checkInputParams.bind(null, bag),
      _getStepArtifactUrl.bind(null, bag),
      _getRunArtifactUrl.bind(null, bag),
      _getPipelineArtifactUrl.bind(null, bag),
      _uploadArtifacts.bind(null, bag),
      _checkPipelineArtifactName.bind(null, bag),
      _updatePipelineArtifactName.bind(null, bag)
    ],
    function (err) {
      if (bag.isGrpSuccess)
        bag.stepConsoleAdapter.closeCmd(true);
      else
        bag.stepConsoleAdapter.closeCmd(false);

      if (err)
        logger.error(bag.who, util.format('Failed to upload artifacts'));
      else
        logger.info(bag.who, 'Successfully uploaded artifacts');

      return callback(err);
    }
  );
}

function _checkInputParams(bag, next) {
  var who = bag.who + '|' + _checkInputParams.name;
  logger.verbose(who, 'Inside');

  var expectedParams = [
    'stepData',
    'stepConsoleAdapter',
    'stepWorkspacePath',
    'runWorkspacePath',
    'pipelineWorkspacePath',
    'builderApiAdapter'
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

function _getStepArtifactUrl(bag, next) {
  var who = bag.who + '|' + _getStepArtifactUrl.name;
  logger.verbose(who, 'Inside');

  bag.stepConsoleAdapter.publishMsg('Getting upload URL for step');

  bag.stepArtifactName = util.format('%s.tar.gz', bag.stepData.step.id);

  var query = 'artifactName=' + bag.stepArtifactName;

  bag.builderApiAdapter.getStepArtifactUrls(bag.stepData.step.id, query,
    function (err, artifactUrls) {
      var msg;
      if (err) {
        msg = util.format('%s, Failed to get artifact URLs for ' +
          'stepId: %s', who, bag.stepData.step.id, err);

        bag.stepConsoleAdapter.publishMsg(msg);
        return next();
      }

      bag.stepArtifactUrl = artifactUrls.put;
      bag.stepArtifactUrlOpts = artifactUrls.putOpts;
      msg = util.format(
        'Got artifact URL for stepId: %s ', bag.stepData.step.id);
      bag.stepConsoleAdapter.publishMsg(msg);
      return next();
    }
  );
}

function _getRunArtifactUrl(bag, next) {
  var who = bag.who + '|' + _getRunArtifactUrl.name;
  logger.verbose(who, 'Inside');

  bag.stepConsoleAdapter.publishMsg('Getting upload URL for run');

  bag.runArtifactName = util.format('%s.tar.gz', bag.stepData.step.runId);

  var query = 'artifactName=' + bag.runArtifactName;

  bag.builderApiAdapter.getRunArtifactUrls(bag.stepData.step.runId, query,
    function (err, artifactUrls) {
      var msg;
      if (err) {
        msg = util.format('%s, Failed to get artifact URLs for ' +
          'runId: %s', who, bag.stepData.step.runId, err);

        bag.stepConsoleAdapter.publishMsg(msg);
        return next();
      }

      bag.runArtifactUrl = artifactUrls.put;
      bag.runArtifactUrlOpts = artifactUrls.putOpts;
      msg = util.format(
        'Got artifact URL for runId: %s ', bag.stepData.step.runId);
      bag.stepConsoleAdapter.publishMsg(msg);
      return next();
    }
  );
}

function _getPipelineArtifactUrl(bag, next) {
  var who = bag.who + '|' + _getPipelineArtifactUrl.name;
  logger.verbose(who, 'Inside');

  bag.stepConsoleAdapter.publishMsg('Getting upload URL for pipeline');

  bag.pipelineArtifactName = util.format('%s.tar.gz',
    bag.stepData.step.id);

  var query = 'artifactName=' + bag.pipelineArtifactName;

  bag.builderApiAdapter.getPipelineArtifactUrls(bag.stepData.step.pipelineId,
    query,
    function (err, artifactUrls) {
      var msg;
      if (err) {
        msg = util.format('%s, Failed to get artifact URLs for ' +
          'pipelineId: %s', who, bag.stepData.step.pipelineId, err);

        bag.stepConsoleAdapter.publishMsg(msg);
        return next();
      }

      bag.pipelineArtifactUrl = artifactUrls.put;
      bag.pipelineArtifactUrlOpts = artifactUrls.putOpts;
      msg = util.format(
        'Got artifact URL for pipelineId: %s ', bag.stepData.step.pipelineId);
      bag.stepConsoleAdapter.publishMsg(msg);
      return next();
    }
  );
}

function _uploadArtifacts(bag, next) {
  var who = bag.who + '|' + _uploadArtifacts.name;
  logger.verbose(who, 'Inside');

  bag.stepConsoleAdapter.publishMsg('Uploading artifacts');

  var scriptBag = {
    stepArtifactUrl: bag.stepArtifactUrl,
    stepArtifactUrlOpts: bag.stepArtifactUrlOpts,
    stepArtifactName: bag.stepArtifactName,
    stepWorkspacePath: bag.stepWorkspacePath,
    runArtifactUrl: bag.runArtifactUrl,
    runArtifactUrlOpts: bag.runArtifactUrlOpts,
    runArtifactName: bag.runArtifactName,
    runWorkspacePath: bag.runWorkspacePath,
    pipelineArtifactUrl: bag.pipelineArtifactUrl,
    pipelineArtifactUrlOpts: bag.pipelineArtifactUrlOpts,
    pipelineArtifactName: bag.pipelineArtifactName,
    pipelineWorkspacePath: bag.pipelineWorkspacePath,
    builderApiAdapter: bag.builderApiAdapter,
    stepConsoleAdapter: bag.stepConsoleAdapter
  };

  upload(scriptBag,
    function (err) {
      if (err) {
        bag.isGrpSuccess = false;
        logger.error(who,
          util.format('Failed to upload artifacts with error: %s', err)
        );
        return next(true);
      }
      logger.debug('Successfully uploaded artifacts');
      return next();
    }
  );
}

function _checkPipelineArtifactName(bag, next) {
  var who = bag.who + '|' + _checkPipelineArtifactName.name;
  logger.debug(who, 'Inside');

  var filePath = path.join(bag.stepWorkspacePath,
    'pipelineArtifactName.txt');

  if (isFile(filePath))
    bag.newPipelineArtifactName = true;

  return next();
}

function _updatePipelineArtifactName(bag, next) {
  if (!bag.newPipelineArtifactName) return next();
  var who = bag.who + '|' + _updatePipelineArtifactName.name;
  logger.verbose(who, 'Inside');

  var update = {
    pipelineStateArtifactName: bag.pipelineArtifactName
  };

  bag.builderApiAdapter.putStepById(bag.stepData.step.id, update,
    function (err) {
      var msg;
      if (err) {
        msg = util.format('%s, Failed to update step %s ' +
          'pipelineStateArtifactName: %s', who,
          bag.stepData.step.id, bag.pipelineArtifactName, err);

        bag.stepConsoleAdapter.publishMsg(msg);
        return next();
      }

      return next();
    }
  );
}
