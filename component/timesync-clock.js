'use strict';

var express = require('express');
var timesyncServer = require('timesync/server');
var timesync = require('timesync');
var Redis = require('ioredis');
var RedisLock = require('ioredis-lock');

var envConfig = require('./env-config.js');

var _log = require('debug')('firebase-server');

/****************************
 *		Timesync Handling
 ****************************/

const redisTimeSyncLockKey = "timesync:snapcache:lock";
const redisTimeSyncKey = "timesync:snapcache:master";
const lockDuration = 60000;

const port = 4000;

const lockConfig =  {
	  timeout: lockDuration,
	  retries: 1,
	  delay: 100
	};

var redis;
var redisLock;

var app = express();
app.listen(port);

_log('Timesync master server listening at http://localhost:' + port);

// allow CORS for browser testing
app.use(function(req, res, next) {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
	res.header('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === "OPTIONS") 
		res.sendStatus(200);
	else 
		next();
});

// handle timesync requests
app.use('/timesync', timesyncServer.requestHandler);

var timesyncInstance;
var ipaddress;
var currentMasterIpaddress;

function accquireAndInitTimeSync(){

	// Check for existing lock and validity, if valid, extend it
	var locks = RedisLock.getAcquiredLocks();
	if(locks.length > 0 && locks[0]['_key'] == redisTimeSyncLockKey){
		var lock = locks[0];

		lock.extend(lockDuration, function(extendErr) {
			if (extendErr) {
				_log(extendErr.message); // 'Lock on key has expired' which should not happen
				lock.release(function(releaseErr){
					if(releaseErr) return _log(releaseErr.message);
				});
			}else{
				// set master ip
				redis.pipeline().set(redisTimeSyncKey, ipaddress).expire(redisTimeSyncKey,lockDuration/1000).exec(function (setErr, result) {
					if(setErr){
						_log(setErr);
					}else{
						// Instantiate or reload timesync
						reinitTimeSyncInstance(ipaddress);
					}
				});
			}
		});

	}else{
		// Try to accquire lock and be the timesync master OR sync with current timesync master
		RedisLock.createLock(redis,lockConfig).acquire(redisTimeSyncLockKey, function(lockErr) {
		  if(lockErr){
		  	// Lock already held
		  	redis.get(redisTimeSyncKey, function (getErr, getMasterIp) {
		  		if(getErr || getMasterIp == null){
		  			// if for some reasons (maybe master disappeared), redis get on timesync key had errors, do a delayed re-accquireAndInitTimeSync again after 5secs
					setTimeout(function() {
						accquireAndInitTimeSync();
					}, 5000);

					return;
		  		}else{
		  			// Instantiate or reload timesync
					reinitTimeSyncInstance(getMasterIp);
		  		}
			});
		  }else{
		  	// Lock not held, proceed to set ip address
		  	redis.pipeline().set(redisTimeSyncKey, ipaddress).expire(redisTimeSyncKey,lockDuration/1000).exec(function (setErr, setResult) {
				if(setErr){
					_log(setErr);
				}else{
					// Instantiate or reload timesync
					reinitTimeSyncInstance(ipaddress);
				}
			});
		  }
		});
	}
}

/****************************
 *		Clock
 ****************************/

function TimesyncClock (time) {
	validateTime(time);

	function invalidTime() {
		throw new Error('time needs to be function / number / falsie');
	}

	function validateTime(newTime) {
		if (newTime &&
			typeof newTime !== 'function' &&
			typeof newTime !== 'number' &&
			!(newTime instanceof TimesyncClock)) {
			invalidTime();
		}
	}

	function getTime() {
		if (typeof time === 'function' || time instanceof TimesyncClock) {
			return time();
		}
		if (typeof time === 'number') {
			return time;
		}
		if (!time) {
			var returnTime = getTimeSyncedTime();
			return returnTime;
		}
		invalidTime();
	}

	getTime.setTime = function (newTime) {
		validateTime(newTime);
		time = newTime;
	};

	return getTime;
}

function getTimeSyncedTime(){
	return timesyncInstance.now();
}

function reinitTimeSyncInstance(ipaddress){
	if(currentMasterIpaddress == undefined) {
		currentMasterIpaddress = ipaddress;
	}else{
		if(currentMasterIpaddress == ipaddress){
			return _log("Current timesync master ip is the same as specificed ip, abort retimesync");
		}
	}

	if(timesyncInstance != undefined){
		timesyncInstance.destroy();
	}

	timesyncInstance = timesync.create({
		server: 'http://' + ipaddress + ':' + port,
		interval: lockDuration * 2
	});
}

/****************************
 *		Exports
 ****************************/

exports.init = function(redisConnectionString){
	// Redis connection
	redis = new Redis(redisConnectionString);

	// Get local ip address, acquire lock on timesync master and set ip address
	require('dns').lookup(require('os').hostname(), function (ipErr, ipadd, fam) {
		ipaddress = ipadd;
		_log("ipaddress: " + ipaddress);

		accquireAndInitTimeSync();

		// Auto relocking
		setInterval(function() {
			_log("relocking");
			accquireAndInitTimeSync();
		 }, lockDuration - 1000);
	})
}

exports.getClock = TimesyncClock;
