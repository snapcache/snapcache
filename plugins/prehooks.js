'use strict';

var _log = require('debug')('firebase-server');

function presave(next,path,data,callback){
	var newData = data;

	// we can perform presave operations here such as manipulating data before saving

	_log("prehooks - presave");
	_log(newData);

	next(path,newData,callback);
}

function predelete(next,path,callback,overwrite){

	// we can perform predelete operations here

	_log("prehooks - predelete");

	next(path,callback,false);
}

/****************************
 *		Exports
 ****************************/

exports.writeData = presave;
exports.updateData = presave;
exports.deleteData = predelete;