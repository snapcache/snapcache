'use strict';

var async_whilst = require('async/whilst');

var _ = require('lodash');

var flatten = require('flat');
var unflatten = require('flat').unflatten;

var Redis = require('ioredis');

var _log = require('debug')('firebase-server');

var _this = this;

var globalListener = {};

const trackerIdentifier = '|tkr|';

/****************************
 *	Helper Functions
 ****************************/

 function wrapJSON(subkeys, jsonData){

 	var oldJSON = jsonData;
 	var newJSON = {};

 	for(var i = subkeys.length; i--;){
 		var tempJSON = newJSON;

 		if(oldJSON != undefined){
 			tempJSON = oldJSON;
 			oldJSON = undefined;
 		}

 		newJSON = appendJSON(subkeys[i],tempJSON);
 	}

 	return newJSON;
 }

 function appendJSON(key, data){
 	var json = {};
 	json[key] = data;
 	return json;
 }

 function checkAndParseValue(value){
	if(/^\d+$/.test(value) == true){
		return parseInt(value);
	}

	if(value == 'true'){
		return true;
	}

	if(value == 'false'){
		return false;
	}

	return value;
 }

/****************************
 * 			Redis
 ****************************/
var redisPub;
var redis;
const redisPrefix = 'snapcache::';
const redisPatternIndex = (redisPrefix).length + 1;

exports.init = function(redisHost, redisDB){

	redis = new Redis({
		port: 6379,
		host: redisHost,
		db: redisDB
	});

	redisPub = new Redis({
		port: 6379,
		host: redisHost,
		db: redisDB
	});
	
	/****************************
	* 		Redis Lua Scripting
	****************************/

	redisPub.defineCommand('getAll', {
	  lua: "return redis.call('MGET', unpack(KEYS), unpack(ARGV))"
	});

	redisPub.defineCommand('deleteAll', {
	  lua: "return redis.call('DEL', unpack(KEYS), unpack(ARGV))"
	});

	redisPub.defineCommand('ssetInsert', {
	  lua: "return redis.call('SADD', ARGV[1], unpack(KEYS))"
	});

	redisPub.defineCommand('ssetRemove', {
	  lua: "return redis.call('SREM', ARGV[1], unpack(KEYS))"
	});

	// redisPub.defineCommand('sscanAll', {
	//   lua: "return redis.call('SSCAN', KEYS[1], 0, 'MATCH', ARGV[1])"
	// });

	// redisPub.defineCommand('scanAll', {
	//   numberOfKeys: 1,
	//   lua: "return redis.call('SCAN', KEYS[1], 'MATCH', ARGV[1], 'COUNT', 100000)"
	// });

	redisPub.defineCommand('setAll', {
	  lua: "for i=1, #KEYS do \
	  		 redis.call('set', KEYS[i], ARGV[i]) \
	  		end"
	});

	/****************************
	* 		Redis Pub Sub Listener
	****************************/
	redis.on('pmessage', function (pattern, channel, message) {
		_log('RedisPub received message %s from channel %s and pattern %s', message, channel, pattern);
		var path = pattern.substring(redisPatternIndex, pattern.length-1);

		_this.retrieveData(path,function(data){
			for (var key in globalListener[path]) {
			  if (globalListener[path].hasOwnProperty(key)) {
			    globalListener[path][key].callback(path,data);
			  }
			}
		});
	});

_log('Redis initialized');
};

 /****************************
 * 		Redis DB functions
 ****************************/

exports.subscribe = function(path, websocket, callbackFunction){

	if(globalListener[path] != undefined){
		globalListener[path][websocket] = {'callback':callbackFunction};
		_log('globalListener without subscribing: ' + JSON.stringify(globalListener));
		_log('globalListener number of websockets for path: ' + Object.keys(globalListener[path]).length);
		return;
	 }else{
	 	globalListener[path] = {};
	 }

	 var subscriptionPath = '*'+ redisPrefix + path + "*";

	redis.psubscribe(subscriptionPath, function (err, count) {
	  // `count` represents the number of channels we are currently subscribed to.
	  _log('RedisPub Subscribed path %s count %s websocket %s', subscriptionPath, count, websocket);
	  if(err){
	  	_log(err);
	  }else{
	  	if(globalListener[path] == undefined){
	  		globalListener[path] = {};
		 }
	  	globalListener[path][websocket] = {'callback':callbackFunction};
	  }
	});

	// _log('globalListener: ' + JSON.stringify(globalListener));
	// _log('globalListener number of websockets for path: ' + Object.keys(globalListener[path]).length);
}

exports.unsubscribe = function(path,websocket){
	if(globalListener[path] != undefined){
		var numOfSockets = Object.keys(globalListener[path]).length;
		_log('globalListener number of websockets for path unsubscribing: ' + numOfSockets);

		if(numOfSockets >= 2){
			delete globalListener[path][websocket];
			return;
		}
	 }

	 var subscriptionPath = '*'+ redisPrefix + path + "*"; 


	redis.punsubscribe(subscriptionPath, function (err, count) {
	  // `count` represents the number of channels we are currently subscribed to.
	  _log('RedisPub Unsubscribed path %s count %s websocket %s', subscriptionPath, count, websocket);
	  if(err){
	  	_log(err);
	  }else{
	  	if(globalListener[path] != undefined && globalListener[path][websocket] != undefined){
	  		delete globalListener[path][websocket];
	  	}
	  	if(globalListener[path] != undefined){
	  		delete globalListener[path];
	  	}
	  }
	});
}


// publish firebase changes to redis channel
function publishChanges(paths,action) {
	if(paths == undefined || paths.length == 0)
		return;

	var pubPath = '';
	var delimiter = '';

	paths.forEach(function(path){
		pubPath += delimiter + redisPrefix + path;
		delimiter = '|';
	});

	_log(pubPath);

	redisPub.publish(pubPath, action);
}



exports.writeData = function(path,newData,callback){
	var pathArray = path.split("/");
	var processedData = wrapJSON(pathArray,newData);
	var flatten_data = flatten(processedData,{delimiter:':'});

	var overwrite = true;
	if(newData == null){
		overwrite = false;
	}

	internalDeleteData(path,function(err, deletedKeys, deletedKeyValues){
		if(err != null){
			_log(err);
		}else{
			if(newData == null){
				callback(null);
				return;
			}

			var originalRedisKeysFromData = [];
			var redisKeys = [];
			var redisData = [];

			for (var key in flatten_data) {
				if (flatten_data.hasOwnProperty(key)) {
					originalRedisKeysFromData.push(key);
					redisKeys.push(key);
					redisData.push(flatten_data[key]);
				}
			}

			var redisMulti = redisKeys.concat(redisData);

			var pathHash = path.replace(/\//g, ':');

			redisPub.setAll(redisKeys.length,redisMulti, function (err, results) {
				if(err != null){
				  	_log(err);
				  	callback('Redis error');
				  }else{
				  	var realModifiedKeys = [];

				  	// loop to compare values and only add them for publishing if they have changed
				  	if(deletedKeys != undefined){

				  		for (var i = 0; i < deletedKeys.length; i++) {
							var indexOfKeyInRedisKeys = redisKeys.indexOf(deletedKeys[i]);

							// keys overlap
							if(indexOfKeyInRedisKeys > -1){
								var valueOfKeyInRedisKeys = redisData[indexOfKeyInRedisKeys];
								if(checkAndParseValue(valueOfKeyInRedisKeys) == checkAndParseValue(deletedKeyValues[i])){
									// if same value, remove key from pubsub publishing
									redisKeys.splice(indexOfKeyInRedisKeys,1);
									redisData.splice(indexOfKeyInRedisKeys,1);
								}
							}else{
								// key overlap not found, add key for pubsub publishing
								realModifiedKeys.push(deletedKeys[i]);
							}
						}
				  	}

				  	addKeysTracker(originalRedisKeysFromData, function(errFromAddKeys){
				  		if(errFromAddKeys){
						  	_log(errFromAddKeys);
						  }else{
						  	var changedKeys = _.union(redisKeys,realModifiedKeys);
						  	publishChanges(changedKeys,"write");
						  	callback(null);
						  }
				  	});
				  }
			});
		}
	},overwrite);
}

exports.updateData = function(path,newData,callback){
	var pathArray = path.split("/");
	var processedData = wrapJSON(pathArray,newData);
	var flatten_data = flatten(processedData,{delimiter:':'});

	var redisKeys = [];
	var redisData = [];

	var keysToPublish = [];

	for (var key in flatten_data) {
		if (flatten_data.hasOwnProperty(key)) {
			redisKeys.push(key);
			redisData.push(flatten_data[key]);
		}
	}

	var redisMulti = redisKeys.concat(redisData);

	var pathHash = path.replace(/\//g, ':');

	// check if data has really changed
	redisPub.getAll(1, redisKeys, function (errFromGet, resultsFromGet) {
		if(errFromGet != null){
			_log(errFromGet);
			callback('Redis error');
		}else{

			// loop to compare values and only add them for publishing if they have changed
			for (var i = 0; i < redisKeys.length; i++) {
				if(redisData[i] == checkAndParseValue(resultsFromGet[i])) 
					continue;

				keysToPublish.push(redisKeys[i]);
			}

			redisPub.setAll(redisKeys.length,redisMulti, function (err, results) {
				if(err != null){
				  	_log(err);
				  	callback('Redis error');
				  }else{
				  	addKeysTracker(redisKeys, function(errFromAddKeys){
				  		if(errFromAddKeys != null){
						  	_log(errFromAddKeys);
						  }else{
						  	publishChanges(keysToPublish,"write");
				  			callback(null);
						  }
				  	});
				  }
			});

		}
	});
}

// retrieve from redis
exports.retrieveData = function(path,callback){
	// **double read if not found
	if(path == undefined){
		callback({});
		return;
	}

	// remove trailing slash if any
	if(path.substring(path.length - 1) == '/'){
		path = path.slice(0, -1);
	}

	var pathHash = path.replace(/\//g, ':')

	getTrackerKeys(pathHash,function(errFromGetTrack,retrievedKeys){
		if(errFromGetTrack){
			_log(errFromGetTrack);
			callback('Redis error');
		}else{
			if(retrievedKeys.length == 0){
				callback(null);
				return;
			}

			redisPub.mget(retrievedKeys,function(errFromMget,results){
				if(errFromMget){
					_log(errFromMget);
					callback('Redis error');
				}else{

					var jsonObject = {};

					// handle data formatting when subscribed to direct path eg. animals/mammals/lion/family should return 'felidae' and not json object
					if(results.length == 1 && retrievedKeys[0] == pathHash){
						callback(checkAndParseValue(results[0]));
						return;
					}

					for (var i = 0; i < results.length; i++) {
						var value = checkAndParseValue(results[i]);

						var key = retrievedKeys[i].replace(pathHash+":",'');
						//** if subscribed to last key, it will not be able to replace

						jsonObject[key] = value;
					}

					callback(unflatten(jsonObject,{delimiter:':'}));
				}
			});
		}
	});
}

exports.deleteData = function(path,callback){
	internalDeleteData(path,function(err){
		callback(err);
	});
}

/****************************
 * 			Helper
 ****************************/

// Internal delete so that plugin hooks dont get triggered twice when doing database write
 function internalDeleteData(path,callback,overwrite){
 	// **double read if not found
	var pathHash = path.replace(/\//g, ':')

	getTrackerKeys(pathHash,function(errFromGetTrack,retrievedKeys){
		if(errFromGetTrack){
			_log(errFromGetTrack);
			callback('Redis error');
		}else{
			if(retrievedKeys.length == 0){
				callback(null);
				return;
			}

			// if delete function is called from redis write with overwrite = true, retrieve key values for cross checking
			if(overwrite == undefined || overwrite == false){

				removeKeysFromTracker(pathHash, function (errFromRemoveKeys,resultsFromRemoveKeys){
					if(errFromRemoveKeys){
						_log(errFromRemoveKeys);
						callback('Redis Error');
					}else{

						redisPub.deleteAll(1, retrievedKeys, function (err, results) {
							if(err != null){
								_log(err);
								callback('Redis error');
							}else{
								publishChanges(retrievedKeys,"write");
		  						callback(null);
							}
						});
					}
				});

			}else{

				redisPub.getAll(1, retrievedKeys, function (errFromGet, resultsFromGet) {
					if(errFromGet != null){
						_log(errFromGet);
						callback('Redis error');
					}else{

						removeKeysFromTracker(pathHash,function(errFromRemoveKeys,resultsFromRemoveKeys){
							if(errFromRemoveKeys){
								_log(errFromSremove);
								callback('Redis Error');
							}else{

								redisPub.deleteAll(1, retrievedKeys, function (err, results) {
									if(err != null){
										_log(err);
										callback('Redis error');
									}else{
										// if delete function is called from redis write with overwrite = true, then do not publish to pubsub
										callback(null,retrievedKeys,resultsFromGet);
									}
								});
							}
						});
					}
				});

			}
		}
	});
 }

// Sets used to track keys in path, usage of multiple sets at each level of the path in order to remove the need 
// to do redis key pattern scans thus improving performance (but increases memory/disk usage)

// example: animals/mammals/lion
// set animals contains set animals/mammals
// set animals/mammals contains set animals/mammals/lion
// set animals/mammals/lion contains the actual redis keys

function addKeysTracker(redisKeys,callback){
	var pathHash = redisKeys.reduce(function(a, b) { // **need to rework this currently only using string length, need to take into account of levels (:) eg. animals:a:b:c:d (5 levels) should be > than animals:abcd:abcd (3 levels)
		return a.length <= b.length ? a : b; 
	})
	var pathArray = pathHash.split(':');
	pathArray.length -= 1;

	var pathArrayInitLength = pathArray.length;

	var prevPathHash = ""; 

	async_whilst(function () {
	  return pathArray.length > 0;
	},
	function (next) {
		var newPathHash = pathArray.join(':');

		// Last level of path hash, so store all the keys in it
		if(pathArray.length == pathArrayInitLength){ // ** code duplicated
			redisPub.ssetInsert(redisKeys.length, redisKeys, [newPathHash], function (errFromSset, resultsFromSset) {
		  		if(errFromSset){
		  			// If error = wrong type , means existing key is not a set, proceed to delete the key and continue with the while loop (to rerun the function again)
		  			if(errFromSset.name == 'ReplyError' && errFromSset.message.includes("WRONGTYPE")){
						redisPub.deleteAll(1, [newPathHash], function (errFromDeleteAll, resultsFromDeleteAll) {
							if(errFromDeleteAll){
								next(errFromDeleteAll);
							}else{
								// Proceed to delete (srem) this key from parent tracker set as well
								var parentPathArray = pathArray.slice();
								parentPathArray.length -= 1;
								
								if(parentPathArray.length > 0){
									redisPub.ssetRemove(1, [newPathHash], [parentPathArray.join(':')], function (errFromSremove, resultsFromSremove) {
								  		if(errFromSremove){
										  	next(errFromSremove);
										}else{
											next();
										}
									});
								}else{
									next();
								}
							}
						});
					}else{
						next(errFromSset);
					}
				}else{
					prevPathHash = newPathHash; // store prev path hash so as to use it as key (set) for next tracker
					pathArray.length -= 1;
				  	next();
				}
		  	});
		}else{
			// Lower path levels, so store the key (set) of prev tracker
			redisPub.ssetInsert(1, [trackerIdentifier + prevPathHash], [newPathHash], function (errFromSset, resultsFromSset) {
		  		if(errFromSset){
		  			// If error = wrong type , means existing key is not a set, proceed to delete the key and continue with the while loop (to rerun the function again)
		  			if(errFromSset.name == 'ReplyError' && errFromSset.message.includes("WRONGTYPE")){
						redisPub.deleteAll(1, [newPathHash], function (errFromDeleteAll, resultsFromDeleteAll) {
							if(errFromDeleteAll){
								next(errFromDeleteAll);
							}else{
								// Proceed to delete (srem) this key from parent tracker set as well
								var parentPathArray = pathArray.slice();
								parentPathArray.length -= 1;

								if(parentPathArray.length > 0){
									redisPub.ssetRemove(1, [newPathHash], [parentPathArray.join(':')], function (errFromSremove, resultsFromSremove) {
								  		if(errFromSremove){
										  	next(errFromSremove);
										}else{
											next();
										}
									});
								}else{
									next();
								}
							}
						});
					}else{
						next(errFromSset);
					}
				}else{
					prevPathHash = newPathHash; // store prev path hash so as to use it as key (set) for next tracker
					pathArray.length -= 1;
				  	next();
				}
		  	});
		}
	},
	function (asyncErr) {
		_log(asyncErr);
		callback(asyncErr);
	});
}

function removeKeysFromTracker(pathHash,callback){
	var toRemoveFromParentSet = []

	var pathsToSearchArray = [pathHash];
	async_whilst(function () {
	  return pathsToSearchArray.length > 0;
	},
	function (next) {
		// if smembers.length = 0, add the pathHash to the redisKey array itself
		redisPub.smembers(pathsToSearchArray[0],function(errFromSmem, resultsFromSmem){
			if(errFromSmem){
				if(errFromSmem.name == 'ReplyError' && errFromSmem.message.substr(0,9) == 'WRONGTYPE'){
					toRemoveFromParentSet.push(pathsToSearchArray[0]);
					pathsToSearchArray.splice(0,1);
					next();
				}else{
					next(errFromSmem);
				}
			}else{

				resultsFromSmem.forEach(function(smemKey) {
					if(smemKey.substr(0,trackerIdentifier.length) == trackerIdentifier){
						pathsToSearchArray.push(smemKey.substr(trackerIdentifier.length));
					}
				});

				redisPub.deleteAll(1, [pathsToSearchArray[0]], function (err, results) {
				  if(err){
				  	_log(err);
				  	next('Redis error');
				  }else{
				  	toRemoveFromParentSet.push(trackerIdentifier + pathsToSearchArray[0]);
				  	pathsToSearchArray.splice(0,1);
				  	next();
				  }
				});
			}
		});
	},
	function (asyncErr) {
		// Remove set from parent path if any
		if(asyncErr){
			callback(asyncErr);
		}else{
			var pathHashArray = pathHash.split(':');
			pathHashArray.length -= 1;

			if(pathHashArray.length > 0){
				redisPub.ssetRemove(toRemoveFromParentSet.length, toRemoveFromParentSet, [pathHashArray.join(':')], function (errFromSremove, resultsFromSremove) {
			  		if(errFromSremove){
					  	callback(errFromSremove);
					  }else{

					  	redisPub.scard(pathHashArray.join(':'),function(errFromScard,resultFromScard){
					  		if(errFromScard){
					  			callback(errFromScard);
					  		}else{

					  			if(resultFromScard == 0){

					  				// While loop to remove tracker keys from parent tracker sets
					  				async_whilst(function () {
									  return pathHashArray.length > 0;
									},
									function (parentNext) {
										// if pathHashArray <= 1 means we should terminate while loop
										if(pathHashArray.length <= 1){
											pathHashArray.length = 0;
											parentNext();
										}else{
											var currentPathHash = pathHashArray.join(':');
											pathHashArray.length -= 1;

											_log("ssetRemove " + pathHashArray.join(':') + ' ' + trackerIdentifier + currentPathHash);
											// Proceed to do srem from tracket set
											redisPub.ssetRemove(1, [trackerIdentifier + currentPathHash],[pathHashArray.join(':')], function (errFromParentSremove, resultsFromParentSremove) {
										  		if(errFromParentSremove){
												  	parentNext(errFromParentSremove);
												  }else{
												  	// Check if tracker set is empty (scard = 0), if so, proceed to remove this current tracker key from its parent tracket set as well
												  	redisPub.scard(pathHashArray.join(':'),function(errFromParentScard,resultFromParentScard){
												  		if(errFromParentScard){
												  			parentNext(errFromParentScard);
												  		}else{
												  			_log("currentPathHash " + currentPathHash);
												  			_log("resultFromParentScard " + resultFromParentScard);
												  			// Current tracker set is not empty, so we set pathHashArray length to 0 in order to stop the while loop function
												  			if(resultFromParentScard > 0){
												  				pathHashArray.length = 0;
												  			}
												  			parentNext();
												  		}
												  	});
												  }
										  	});
										}
									},
									function (parentAsyncErr) {
										if(parentAsyncErr){
											callback(parentAsyncErr);
										}else{
											callback(null);
										}
									});
					  			}else{
					  				callback(null);
					  			}
					  		}
					  	});
					  }
			  	});
			}else{
				callback(null);
			}
		}
	});
}

function getTrackerKeys(pathHash,callback){
	var redisKeys = [];

	var pathsToSearchArray = [pathHash];
	async_whilst(function () {
	  return pathsToSearchArray.length > 0;
	},
	function (next) {
		// if smembers.length = 0, add the pathHash to the redisKey array itself
		redisPub.smembers(pathsToSearchArray[0],function(errFromSmem, resultsFromSmem){
			if(errFromSmem){
				if(errFromSmem.name == 'ReplyError' && errFromSmem.message.substr(0,9) == 'WRONGTYPE'){
					redisKeys.push(pathsToSearchArray[0]);
					pathsToSearchArray.splice(0,1);
					next();
				}else{
					next(errFromSmem);
				}
			}else{

				pathsToSearchArray.splice(0,1);

				resultsFromSmem.forEach(function(smemKey) {
					if(smemKey.substr(0,trackerIdentifier.length) == trackerIdentifier){
						pathsToSearchArray.push(smemKey.substr(trackerIdentifier.length));
					}else{
						redisKeys.push(smemKey);
					}
				});

				next();
			}
		});
	},
	function (asyncErr) {
	  callback(asyncErr,redisKeys);
	});
}