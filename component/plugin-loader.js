'use strict';

const fs = require('fs');
var path = require('path');

const appDir  = path.dirname(require.main.filename);

exports.loadDir = function(dir, callback) {
    var aret = Array();
        fs.readdirSync(appDir + dir).forEach(function (library) {
            var isLibrary = library.split(".").length > 0 && library.split(".")[1] === 'js',
            libName = library.split(".")[0].toLowerCase();
            if (isLibrary) {
                aret[libName] = require(path.join(appDir + dir, library));
            }
        });
    if(callback) process.nextTick(function() {
        callback(null, aret);
    });
    return  aret;
}