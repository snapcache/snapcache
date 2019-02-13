'use strict';

var _ = require('lodash');
var Ruleset = require('targaryen/lib/ruleset');
var RuleDataSnapshot = require('targaryen/lib/rule-data-snapshot');
var firebaseHash = require('./lib/firebase-hash');
var TimesyncClock = require('./component/timesync-clock');
var TokenValidator = require('./lib/token-validator');
var Promise = require('any-promise');

var database = require('./component/redis-db.js');

var _log = require('debug')('firebase-server');

/****************************
 *		Global functions
 ****************************/

function getSnap(ref) {
	return new Promise(function (resolve) {
		database.retrieveData(ref,function (snap){
			resolve(snap);
		});
	});
}

function exportData(ref) {
	return getSnap(ref).then(function (snap) {
		return snap;
	});
}

function normalizePath(fullPath) {
	var path = fullPath;
	var isPriorityPath = /\/?\.priority$/.test(path);
	if (isPriorityPath) {
		path = path.replace(/\/?\.priority$/, '');
	}
	if (path.charAt(0) === '/') {
		// Normally, a path would start with a slash ("/"), but some clients
		// (notably Android) don't always send it.
		path = path.substr(1);
	}
	return {
		isPriorityPath: isPriorityPath,
		path: path,
		fullPath: fullPath
	};
}

function FirebaseServer(serverURL, wss) {
	this.name = serverURL;

	this.baseRef = '';

	this._wss = wss;

	this._clock = TimesyncClock.getClock();
	this._tokenValidator = new TokenValidator(null, this._clock);

	this._wss.on('connection', this.handleConnection.bind(this));
	_log('Listening for connections on url ' + this.name);
}

FirebaseServer.prototype = {
	// ** here temporarily to faciliate restful api
	authData: function(authToken,callback) {
		var data;
		if (authToken) {
			try {
				var decodedToken = this._tokenValidator.decode(authToken);
				_log('Decoded token ' + JSON.stringify(decodedToken));
				if ('d' in decodedToken) {
					data = decodedToken.d;
				} else {
					data = {
						// 'user_id' is firebase-specific and may be
						// convenience only; 'sub' is standard JWT.
						uid: decodedToken.user_id || decodedToken.sub,
						provider: decodedToken.provider_id,
						token: decodedToken,
					};
				}
			} catch (e) {
				// Auth token error response handling
				var errorResponse = e.message;
				if(errorResponse == 'Signature verification failed' || errorResponse == 'invalid timestamp'){
					errorResponse = 'Failed to validate MAC.'
				}else{
					errorResponse = 'Could not parse auth token.'
				}

				callback(errorResponse,null);
				return;
			}
		}
		callback(null,data);
	},
	handleConnection: function (ws) {
		// connection handling to detect and handle closed ws connections **revision needed
		ws.isAlive = true;
		ws.listeners = []; // for listener handler
		ws.identifier = ws._socket.remoteAddress + ':' + ws._socket.remotePort;

 		ws.on('close', function close() {
 			ws.isAlive = false;
 			for(var index in ws.listeners){
 				var listener = ws.listeners[index];
 				var originalPath = listener['path'].replace(/\//g, ':');
 				database.unsubscribe(originalPath,ws.identifier);
 				_log('Closed connection - removed listener: ' + originalPath + ' websocket: ' + ws.identifier);
 			}
		});

		// error handling
		ws.on('error', function(err){
			ws.close();
			_log('Connection error : ' + err);
		});

		_log('New connection from ' + ws._socket.remoteAddress + ':' + ws._socket.remotePort);
		var server = this;
		var authToken = null;

		function send(message) {
			var payload = JSON.stringify(message);
			_log('Sending message: ' + payload);

			try {
				ws.send(payload);
			} catch (e) {
				_log('Send failed: ' + e);
			}
		}

		function authData() {
			var data;
			if (authToken) {
				try {
					var decodedToken = server._tokenValidator.decode(authToken);
					if ('d' in decodedToken) {
						data = decodedToken.d;
					} else {
						data = {
							// 'user_id' is firebase-specific and may be
							// convenience only; 'sub' is standard JWT.
							uid: decodedToken.user_id || decodedToken.sub,
							provider: decodedToken.provider_id,
							token: decodedToken,
						};
					}
				} catch (e) {
					authToken = null;
				}
			}
			return data;
		}

		function pushData(path, data) {
			send({d: {a: 'd', b: {p: path, d: data}}, t: 'd'});
		}

		function permissionDenied(requestId) {
			send({d: {r: requestId, b: {s: 'permission_denied', d: 'Permission denied'}}, t: 'd'});
		}

		function replaceServerTimestamp(data) {
			if (_.isEqual(data, { '.sv': 'timestamp' })) {
				return server._clock();
			} else if (_.isObject(data)) {
				return _.mapValues(data, replaceServerTimestamp);
			} else {
				return data;
			}
		}

		function ruleSnapshot(fbRef) {
			return exportData(fbRef.root).then(function (exportVal) {
				return new RuleDataSnapshot(RuleDataSnapshot.convert(exportVal));
			});
		}

		function tryRead(requestId, path, fbRef) {
			if (server._ruleset) {
				return ruleSnapshot(fbRef).then(function (dataSnap) {
					var result = server._ruleset.tryRead(path, dataSnap, authData());
					if (!result.allowed) {
						permissionDenied(requestId);
						throw new Error('Permission denied for client to read from ' + path + ': ' + result.info);
					}
					return true;
				});
			}
			return Promise.resolve(true);
		}

		function tryWrite(requestId, path, fbRef, newData) {
			if (server._ruleset) {
				return ruleSnapshot(fbRef).then(function (dataSnap) {
					var result = server._ruleset.tryWrite(path, dataSnap, newData, authData());
					if (!result.allowed) {
						permissionDenied(requestId);
						throw new Error('Permission denied for client to write to ' + path + ': ' + result.info);
					}
					return true;
				});
			}
			return Promise.resolve(true);
		}

		function handleListen(requestId, normalizedPath, fbRef) {
			var path = normalizedPath.path;
			_log('Client listen ' + path);

			tryRead(requestId, path, fbRef)
				.then(function () {
					var sendOk = true;

					// Node event handler
					var handleEventCallback =function(path,newData){
						_log("Callback from Event at Path: " + path);
						var originalPath = path.replace(/\:/g, '\/');
						if(ws.isAlive){
							pushData(originalPath, newData);

							if (sendOk) {
								sendOk = false;
								send({d: {r: requestId, b: {s: 'ok', d: {}}}, t: 'd'});
							}
						}else{
							database.unsubscribe(path,ws.identifier);
						}
					}

					database.retrieveData(path,function response(newData){
						pushData(path, newData);

						if (sendOk) {
							sendOk = false;
							send({d: {r: requestId, b: {s: 'ok', d: {}}}, t: 'd'});
						}
					});

					var pathHash = path.replace(/\//g, ':');
					database.subscribe(pathHash, ws._socket.remoteAddress + ':' + ws._socket.remotePort, handleEventCallback);
					ws.listeners.push({path : path});

				})
				.catch(_log);
		}

		function handleUpdate(requestId, normalizedPath, fbRef, newData) {
			var path = normalizedPath.path;
			_log('Client update ' + path);

			newData = replaceServerTimestamp(newData);

			var checkPermission = Promise.resolve(true);

			if (server._ruleset) {
				checkPermission = exportData(fbRef).then(function (currentData) {
					var mergedData = _.assign(currentData, newData);
					return tryWrite(requestId, path, fbRef, mergedData);
				});
			}

			checkPermission.then(function () {

				//Redis Update
				database.updateData(path,newData,function(err){
					if(err != null){
						_log(err);
					}else{
						send({d: {r: requestId, b: {s: 'ok', d: {}}}, t: 'd'});
					}
				});
				
			}).catch(_log);
		}

		function handleSet(requestId, normalizedPath, fbRef, newData, hash) {
			_log('Client set ' + normalizedPath.fullPath);

			var progress = Promise.resolve(true);
			var path = normalizedPath.path;

			newData = replaceServerTimestamp(newData);

			if (normalizedPath.isPriorityPath) {
				progress = exportData(fbRef).then(function (parentData) {
					if (_.isObject(parentData)) {
						parentData['.priority'] = newData;
					} else {
						parentData = {
							'.value': parentData,
							'.priority': newData
						};
					}
					newData = parentData;
				});
			}

			progress = progress.then(function () {
				return tryWrite(requestId, path, fbRef, newData);
			});

			if (typeof hash !== 'undefined') {
				progress = progress.then(function () {
					return getSnap(fbRef);
				}).then(function (snap) {
					var calculatedHash = firebaseHash(snap.exportVal());
					if (hash !== calculatedHash) {
						pushData(path, snap.exportVal());
						send({d: {r: requestId, b: {s: 'datastale', d: 'Transaction hash does not match'}}, t: 'd'});
						throw new Error('Transaction hash does not match: ' + hash + ' !== ' + calculatedHash);
					}
				});
			}

			progress.then(function () {

				//Redis Insert
				database.writeData(path,newData,function(err){
					if(err != null){
						_log(err);
					}else{
						send({d:{b:{p:path,d:newData},a:'d'}, t: 'd'});
						send({d: {r: requestId, b: {s: 'ok', d: ''}}, t: 'd'});
					}
				});

			}).catch(_log);
		}

		function handleAuth(requestId, credential) {
			if (server._authSecret === credential || server._authSecret == undefined) {
				return send({t: 'd', d: {r: requestId, b: {s: 'ok', d: TokenValidator.normalize({ auth: null, admin: true, exp: null }) }}});
			}

			try {
				var decoded = server._tokenValidator.decode(credential);
				authToken = credential;
				return send({t: 'd', d: {r: requestId, b: {s: 'ok', d: TokenValidator.normalize(decoded)}}});
			} catch (e) {
				return send({t: 'd', d: {r: requestId, b: {s: 'invalid_token', d: 'Could not parse auth token.'}}});
			}
		}

		function accumulateFrames(data){
			//Accumulate buffer until websocket frame is complete
			if (typeof ws.frameBuffer == 'undefined'){
				ws.frameBuffer = '';
			}

			try {
				var parsed = JSON.parse(ws.frameBuffer + data);
				ws.frameBuffer = '';
				return parsed;
			} catch(e) {
				ws.frameBuffer += data;
			}

			return '';
		}

		ws.on('message', function (data) {
			_log('Client message: ' + data);
			if (data === 0) {
				return;
			}

			var parsed = accumulateFrames(data);

			if (parsed && parsed.t === 'd') {
				var path;
				if (typeof parsed.d.b.p !== 'undefined') {
					path = parsed.d.b.p;
				}
				path = normalizePath(path || '');
				var requestId = parsed.d.r;

				var fbRef = path.path || this.baseRef;
				// var fbRef = path.path ? this.baseRef.child(path.path) : this.baseRef;
				if (parsed.d.a === 'l' || parsed.d.a === 'q') {
					handleListen(requestId, path, fbRef);
				}
				if (parsed.d.a === 'm') {
					handleUpdate(requestId, path, fbRef, parsed.d.b.d);
				}
				if (parsed.d.a === 'p') {
					handleSet(requestId, path, fbRef, parsed.d.b.d, parsed.d.b.h);
				}
				if (parsed.d.a === 'auth' || parsed.d.a === 'gauth') {
					handleAuth(requestId, parsed.d.b.cred);
				}
			}
		}.bind(this));

		send({d: {t: 'h', d: {ts: new Date().getTime(), v: '5', h: this.name, s: ''}}, t: 'c'});
	},

	setRules: function (rules) {
		this._ruleset = new Ruleset(rules);
	},

	getData: function (ref) {
		console.warn('FirebaseServer.getData() is deprecated! Please use FirebaseServer.getValue() instead'); // eslint-disable-line no-console
		var result = null;
		this.baseRef.once('value', function (snap) {
			result = snap.val();
		});
		return result;
	},

	getSnap: function (ref) {
		_log("getSnap ref " + JSON.stringify(ref || this.baseRef));
		return getSnap(ref || this.baseRef);
	},

	getValue: function (ref) {
		_log("getValue ref " + JSON.stringify(ref || this.baseRef));
		return this.getSnap(ref).then(function (snap) {
			return snap.val();
		});
	},

	exportData: function (ref) {
		return exportData(ref || this.baseRef);
	},

	close: function (callback) {
		this._wss.close(callback);
	},

	setTime: function (newTime) {
		this._clock.setTime(newTime);
	},

	setAuthSecret: function (newSecret) {
		this._authSecret = newSecret;
		this._tokenValidator.setSecret(newSecret);
	}
};

module.exports = FirebaseServer;
