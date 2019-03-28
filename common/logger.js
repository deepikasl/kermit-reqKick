'use strict';

var winston = require('winston');
var util = require('util');

module.exports = function () {
  winston.clear();
  winston.add(winston.transports.Console, {
    timestamp: true,
    colorize: true,
    level: 'warn'
  });

  winston.add(winston.transports.File, {
    name: 'file#out',
    timestamp: true,
    colorize: true,
    filename: util.format('logs/reqKick.log'),
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 20,
    level: 'warn',
    json: false
  });

  winston.add(winston.transports.File, {
    name: 'file#err',
    timestamp: true,
    colorize: true,
    filename: util.format('logs/reqKick_err.log'),
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 20,
    level: 'error',
    json: false
  });

  winston.add(winston.transports.File, {
    name: 'file#warn',
    timestamp: true,
    colorize: true,
    filename: util.format('logs/reqKick_warn.log'),
    maxsize: 5 * 1024 * 1024, // 5 MB
    maxFiles: 20,
    level: 'warn',
    json: false
  });

  winston.add(winston.transports.File, {
    name: 'file#info',
    timestamp: true,
    colorize: true,
    filename: util.format('logs/reqKick_info.log'),
    maxsize: 5 * 1024 * 1024, // 5 MB
    maxFiles: 20,
    level: 'info',
    json: false
  });

  winston.add(winston.transports.File, {
    name: 'file#debug',
    timestamp: true,
    colorize: true,
    filename: util.format('logs/reqKick_debug.log'),
    maxsize: 5 * 1024 * 1024, // 5 MB
    maxFiles: 20,
    level: 'debug',
    json: false
  });

  return winston;
};
