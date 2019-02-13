'use strict';

var servletLogger = require('./component/servlet-logger.js');
var _ = require('lodash');

var database = require('./component/redis-db.js');

var Connector = require('./component/connector.js');

var adminConnector = new Connector();

var app = adminConnector.getApp();

// Middleware to handle logging
app.use(function (req, res, next) {
	servletLogger.log(req);
	next();
})

/****************************
 *		Restful Api
 ****************************/

// for disabling admin routes (temporary)
var adminEnabled = true;

app.post('/disableadminapi', function(req, res) {
	adminEnabled = false;
    res.status(200).send();
});

app.post('/enableadminapi', function(req, res) {
	adminEnabled = true;
    res.status(200).send();
});

app.get('/*', function (req, res) {
	//res.json(null);

	if(adminEnabled){
		var path = adminConnector.removeTrailingSlashAndFormatPath(req.path);

		database.retrieveData(path,function response(newData){
			res.json(newData);
		});
	}else{
		res.json(null);
	}
});

app.post('/*', function (req, res) {
	if(adminEnabled){
		var path = adminConnector.removeTrailingSlashAndFormatPath(req.path);
		var dataJSON = adminConnector.replaceServerTimestamp(req.body);

		// wrap in generated pushid key
		var wrappedDataJSON = {};
		var generatedPushId = adminConnector.generatePushID()();
		wrappedDataJSON[generatedPushId] = dataJSON;

		database.updateData(path,wrappedDataJSON,function(error){
			if(error == null){
				res.json({name:generatedPushId});
			}
		});
	}else{
		res.json(null);
	}
});

app.put('/*', function (req, res) {
	if(adminEnabled){
		var path = adminConnector.removeTrailingSlashAndFormatPath(req.path);

		var dataJSON;

		if(req.isJSON){
			dataJSON = adminConnector.replaceServerTimestamp(req.body);
		}else{
			dataJSON = req.rawBody;
		}

		database.writeData(path,dataJSON,function(error){
			if(error == null){
				res.json(dataJSON);
			}
		});
	}else{
		res.json(null);
	}
});

app.patch('/*', function (req, res) {
	if(adminEnabled){
		var path = adminConnector.removeTrailingSlashAndFormatPath(req.path);
		var newdataJSON = adminConnector.replaceServerTimestamp(req.body);

		database.updateData(path,newdataJSON,function(error){
			if(error == null){
				res.json(newdataJSON);
			}
		});
	}else{
		res.json(null);
	}
});

app.delete('/*', function (req, res) {
	if(adminEnabled){
		var path = adminConnector.removeTrailingSlashAndFormatPath(req.path);
		var dataJSON = {};

		database.deleteData(path,function(error){
			if(error == null){
				res.json(null);
			}
		});
	}else{
		res.json(null);
	}
});

adminConnector.init();

/****************************
 *		Exports
 ****************************/

exports.wss = adminConnector.getWS();
exports.httpserver = adminConnector.getServer();

exports.link = function(snapcache){
	adminConnector.linkSnapcache(snapcache);
}