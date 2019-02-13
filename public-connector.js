'use strict';

var servletLogger = require('./component/servlet-logger.js');
var _ = require('lodash');

const uuidv1 = require('uuid/v1');

var database = require('./component/redis-db.js');

var Connector = require('./component/connector.js');

var publicConnector = new Connector();

var app = publicConnector.getApp();

// Middleware to handle auth rules
app.use(function (req, res, next) {
	servletLogger.log(req);

	var authToken = req.query.auth;

	if(authToken != undefined){
		publicConnector.getSnapcache().authData(authToken,function(error,tokenData){
			if(error != null){
				return res.status(401).json({error:error});
			}else{
				req.credentials = tokenData;
				next();
			}
		});
	}else{
		req.credentials = null;
		next();
	}
})

/****************************
 *		Restful Api
 ****************************/

app.get('/*', function (req, res) {
	var path = publicConnector.removeTrailingSlashAndFormatPath(req.path);

	if(publicConnector.getSnapcache()._ruleset){
		var result = publicConnector.getSnapcache()._ruleset.tryRead(path, publicConnector.convertRuleSnapshot({}), req.credentials);
		if (!result.allowed) {
			return res.status(403).json({error:'Permission denied'});
		}else{
			database.retrieveData(path,function response(newData){

				// if is SSE, proceed to register SSE connection and use SSE send instead
				if(req.isSSE){
					res.sseSetup();
					res.sseSend(path,newData);

					req.sseUUID = uuidv1();
					req.pathHash = path.replace(/\//g, ':');

					database.subscribe(req.pathHash, req.sseUUID, res.sseSend);

					req.on("close", function() {
					  database.unsubscribe(req.pathHash,req.sseUUID);
					});

					req.on("end", function() {
					  database.unsubscribe(req.pathHash,req.sseUUID);
					});
				}else{
					res.json(newData);
				}
			});
		}
	}else{
		database.retrieveData(path,function response(newData){
			// if is SSE, proceed to register SSE connection and use SSE send instead
			if(req.isSSE){
				res.sseSetup();
					res.sseSend(path,newData);

					req.sseUUID = uuidv1();
					req.pathHash = path.replace(/\//g, ':');

					database.subscribe(req.pathHash, req.sseUUID, res.sseSend);

					req.on("close", function() {
					  database.unsubscribe(req.pathHash,req.sseUUID);
					});

					req.on("end", function() {
					  database.unsubscribe(req.pathHash,req.sseUUID);
					});
			}else{
				res.json(newData);
			}
		});
	}

});

app.post('/*', function (req, res) {
	var path = publicConnector.removeTrailingSlashAndFormatPath(req.path);
	var dataJSON = publicConnector.replaceServerTimestamp(req.body);

	// wrap in generated pushid key
	var wrappedDataJSON = {};
	var generatedPushId = publicConnector.generatePushID()();
	wrappedDataJSON[generatedPushId] = dataJSON;

	if(publicConnector.getSnapcache()._ruleset){
		database.retrieveData(path,function response(data){
			var result = publicConnector.getSnapcache()._ruleset.tryWrite(path, publicConnector.convertRuleSnapshot(data), wrappedDataJSON, req.credentials);
			if (!result.allowed) {
				return res.status(403).json({error:'Permission denied'});
			}else{
				database.updateData(path,wrappedDataJSON,function(error){
					if(error == null){
						res.json({name:generatedPushId});
					}
				});
			}
		});
	}else{
		database.updateData(path,wrappedDataJSON,function(error){
			if(error == null){
				res.json({name:generatedPushId});
			}
		});
	}
});

app.put('/*', function (req, res) {
	var path = publicConnector.removeTrailingSlashAndFormatPath(req.path);
	var dataJSON = publicConnector.replaceServerTimestamp(req.body);

	if(publicConnector.getSnapcache()._ruleset){
		database.retrieveData(path,function response(data){
			var result = publicConnector.getSnapcache()._ruleset.tryWrite(path, publicConnector.convertRuleSnapshot(data), dataJSON, req.credentials);
			if (!result.allowed) {
				return res.status(403).json({error:'Permission denied'});
			}else{
				database.writeData(path,dataJSON,function(error){
					if(error == null){
						res.json(dataJSON);
					}
				});
			}
		});
	}else{
		database.writeData(path,dataJSON,function(error){
			if(error == null){
				res.json(dataJSON);
			}
		});
	}
});

app.patch('/*', function (req, res) {
	var path = publicConnector.removeTrailingSlashAndFormatPath(req.path);
	var newdataJSON = publicConnector.replaceServerTimestamp(req.body);

	if(publicConnector.getSnapcache()._ruleset){
		database.retrieveData(path,function response(data){
			var mergedData = _.assign(data, newdataJSON);
			var result = publicConnector.getSnapcache()._ruleset.tryWrite(path, publicConnector.convertRuleSnapshot(data), mergedData, req.credentials);
			if (!result.allowed) {
				return res.status(403).json({error:'Permission denied'});
			}else{
				database.updateData(path,newdataJSON,function(error){
					if(error == null){
						res.json(newdataJSON);
					}
				});
			}
		});
	}else{
		database.updateData(path,newdataJSON,function(error){
			if(error == null){
				res.json(newdataJSON);
			}
		});
	}
});

app.delete('/*', function (req, res) {
	var path = publicConnector.removeTrailingSlashAndFormatPath(req.path);
	var dataJSON = {};

	if(publicConnector.getSnapcache()._ruleset){
		database.retrieveData(path,function response(data){
			var result = publicConnector.getSnapcache()._ruleset.tryWrite(path, publicConnector.convertRuleSnapshot(data), dataJSON, req.credentials);
			if (!result.allowed) {
				return res.status(403).json({error:'Permission denied'});
			}else{
				database.deleteData(path,function(error){
					if(error == null){
						res.json(null);
					}
				});
			}
		});
	}else{
		database.deleteData(path,function(error){
			if(error == null){
				res.json(null);
			}
		});
	}
});

publicConnector.init();

/****************************
 *		Exports
 ****************************/

exports.wss = publicConnector.getWS();
exports.httpserver = publicConnector.getServer();

exports.link = function(snapcache){
	publicConnector.linkSnapcache(snapcache);
}