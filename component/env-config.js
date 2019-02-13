'use strict';

exports.get = function(variableName) {
	return process.env[variableName];
}