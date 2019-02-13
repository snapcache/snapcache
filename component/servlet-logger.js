'use strict';

var _log = require('debug')('firebase-server');

exports.log = function(req){
	_log("Servlet Request:: " + req.method + " , URL: " + req.protocol + '://' + req.get('host') + req.originalUrl);
}