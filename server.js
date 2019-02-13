'use strict';

/****************************
 *		Snapcache Main
 ****************************/
var debug = require('debug');
debug.enable('firebase-server*');

var _log = require('debug')('firebase-server');

// Hooks for hooking plugins to database function
var hooks = require('hooks-fixed');
var database = require('./component/redis-db.js');
for (var k in hooks) {
  database[k] = hooks[k];
}

// Dynamically load plugins
var pluginLoader = require('./component/plugin-loader');

pluginLoader.loadDir('/plugins', function(err,plugins){
	// Loop through plugins
	for (var pluginFile in plugins) {
	  if (plugins.hasOwnProperty(pluginFile)) {
	  	var plugin = plugins[pluginFile];
	  	// Loop through each function in plugin and hook them up
	  	for(var functionName in plugin){
	  		_log(pluginFile + ' : ' + functionName);
	  		if (typeof database[functionName] === "function") { 
	  			database.pre(functionName,plugin[functionName]);
			}else{
				_log('Plugin: ' + pluginFile + ' ,function: ' + functionName + ' hook failed, function name is invalid!');
			}
		}
	  }
	}
});

	
// Timesync Init

const TimesyncRedisHost = 'localhost';
const TimesyncRedisPort = 6379;
const TimesyncRedisDB = 10;
var TimesyncClock = require('./component/timesync-clock.js');
TimesyncClock.init('redis://'+TimesyncRedisHost+':'+TimesyncRedisPort+'/'+TimesyncRedisDB);

// Redis DB Init

const redisHostURL = 'localhost';
const redisDB = 10;

var database = require('./component/redis-db.js');
database.init(redisHostURL,redisDB);

// Http/WS Connectors Init

var publicConnector = require('./public-connector.js');
var adminConnector = require('./admin-connector.js');

var FirebaseServer = require('./index.js');

// Public Snapcache

const publicPort = 8080;
var publicSnapcache = new FirebaseServer('localhost:'+publicPort,publicConnector.wss, true); // for local dev

publicSnapcache.setAuthSecret("<legacy firebase JWT auth token>");

// Firebase Rules

publicSnapcache.setRules({
    "rules": {
        ".read": "auth.admin == true",
        ".write": "auth.admin == true",
        "animals": {
        	"$family": {
        		".read": true
            }
        },
        "tasks": {
        	".read": true,
        	".write": true,
        }
    }
});

publicConnector.link(publicSnapcache);
publicConnector.httpserver.listen(publicPort);

// Admin Snapcache

const adminPort = 8081;
var adminSnapcache = new FirebaseServer('localhost:'+adminPort,adminConnector.wss, false);

adminConnector.link(adminSnapcache);
adminConnector.httpserver.listen(adminPort);

_log('Snapcache initialized');