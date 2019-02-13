'use strict';

var RuleDataSnapshot = require('targaryen/lib/rule-data-snapshot');
var _ = require('lodash');

var _log = require('debug')('firebase-server');

const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const WebSocket = require('ws');

var sse = require('./sse')

/****************************
 *		Connector for Http and Websocket Traffic
 ****************************/

 function Connector() {
 	this._app = express();

	// Handles both application/json and plain text inputs using bodyParser
	var rawBodySaver = function (req, res, buf, encoding) {
	  if (buf && buf.length) {
	    req.rawBody = buf.toString(encoding || 'utf8');
	  }
	}

	this._app.use(bodyParser.json({ verify: rawBodySaver }));
	this._app.use(bodyParser.urlencoded({ verify: rawBodySaver, extended: true }));
	this._app.use(bodyParser.raw({ verify: rawBodySaver, type: '*/*' }));

	// Handle favicon.ico
	this._app.get('/favicon.ico', function(req, res) {
	    res.sendStatus(204);
	});

	// Populate isJSON variable for later use
	this._app.use(function (req, res, next) {
		var contype = req.headers['content-type'];
		if (!contype || contype.indexOf('application/json') !== 0){
			req.isJSON = false;
		}else{
			req.isJSON = true;
		}

		// Check for malformed URI
		try {
			decodeURIComponent(req.path)
		}catch(err) {
			console.log(err);
			return res.status(400).json({error:'Malformed URI'});
		}
	  
		next();
	});

	// Hook up SSE middleware
	this._app.use(sse);
}

Connector.prototype = {
	init: function(wssDisabled) {
		this._server = http.createServer(this._app);
		if(wssDisabled == undefined || wssDisabled == false){
			var server = this._server;
			this._wss = new WebSocket.Server({ server });
		}
	},
	getApp: function(){
		return this._app;
	},
	getWS: function(){
		return this._wss;
	},
	getServer: function(){
		return this._server;
	},
	getSnapcache: function(){
		return this._snapcache;
	},
	linkSnapcache: function(snapcache){
		this._snapcache = snapcache;
	},
	/****************************
	 *		Helpers
	 ****************************/
	 removeTrailingSlashAndFormatPath: function(path){
	 	var pathClone = decodeURIComponent(path.substr(1).replace('/.json','').replace('.json','').replace('//','/'));

	 	// Remove trailing slash if any
	 	if(path.substring(path.length - 1) == '/'){
			pathClone = path.slice(0, -1);
		}

		_log(pathClone);

		return pathClone;
	 },

	 replaceServerTimestamp: function(data) {
		if (_.isEqual(data, { '.sv': 'timestamp' })) {
			return this._snapcache._clock();
		} else if (_.isObject(data)) {
			return _.mapValues(data, this.replaceServerTimestamp, this);
		} else {
			return data;
		}
	},

	convertRuleSnapshot: function(data) {
		return new RuleDataSnapshot(RuleDataSnapshot.convert(data));
	},

	/**
	 * Fancy ID generator that creates 20-character string identifiers with the following properties:
	 *
	 * 1. They're based on timestamp so that they sort *after* any existing ids.
	 * 2. They contain 72-bits of random data after the timestamp so that IDs won't collide with other clients' IDs.
	 * 3. They sort *lexicographically* (so the timestamp is converted to characters that will sort properly).
	 * 4. They're monotonically increasing.  Even if you generate more than one in the same timestamp, the
	 *    latter ones will sort after the former ones.  We do this by using the previous random bits
	 *    but "incrementing" them by 1 (only in the case of a timestamp collision).
	  */
	generatePushID: function() {
	  // Modeled after base64 web-safe chars, but ordered by ASCII.
	  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

	  // Timestamp of last push, used to prevent local collisions if you push twice in one ms.
	  var lastPushTime = 0;

	  // We generate 72-bits of randomness which get turned into 12 characters and appended to the
	  // timestamp to prevent collisions with other clients.  We store the last characters we
	  // generated because in the event of a collision, we'll use those same characters except
	  // "incremented" by one.
	  var lastRandChars = [];

	  return function() {
	    var now = new Date().getTime();
	    var duplicateTime = (now === lastPushTime);
	    lastPushTime = now;

	    var timeStampChars = new Array(8);
	    for (var i = 7; i >= 0; i--) {
	      timeStampChars[i] = PUSH_CHARS.charAt(now % 64);
	      // NOTE: Can't use << here because javascript will convert to int and lose the upper bits.
	      now = Math.floor(now / 64);
	    }
	    if (now !== 0) throw new Error('We should have converted the entire timestamp.');

	    var id = timeStampChars.join('');

	    if (!duplicateTime) {
	      for (i = 0; i < 12; i++) {
	        lastRandChars[i] = Math.floor(Math.random() * 64);
	      }
	    } else {
	      // If the timestamp hasn't changed since last push, use the same random number, except incremented by 1.
	      for (i = 11; i >= 0 && lastRandChars[i] === 63; i--) {
	        lastRandChars[i] = 0;
	      }
	      lastRandChars[i]++;
	    }
	    for (i = 0; i < 12; i++) {
	      id += PUSH_CHARS.charAt(lastRandChars[i]);
	    }
	    if(id.length != 20) throw new Error('Length should be 20.');

	    return id;
	  };
	}
};

module.exports = Connector;