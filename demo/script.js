'use strict';

// Variables that hold database reference
var fbapp;
var fbdb;

/**
 * Subscribe to data changes
 */
function subscribe(path, callback) {
    var data_node = fbdb.ref(path);

    console.log(path);

    data_node.on('value', function(data) {
        console.log(data);
        if(data.val() && Object.keys(data.val()).length > 0) {
            callback(path,data.val());
        } else {
            callback(path,null);
        }
    });
}

/**
 * Unsubscribe to data changes
 */
function unsubscribe(path) {
    var data_node = fbdb.ref(path);
    data_node.off();
}

// Initialize on page load
window.addEventListener('load', function() {

    // Init Firebase SDK and connect to snapcache
    fbapp = firebase.initializeApp({
        databaseURL: 'ws://localhost:8080'
    });

    fbdb = firebase.database();

    // Define callback, this will be triggered on first data retrieval
    // Ideally you should write your code here to process callbacks
    var callback = function(path,data){
        console.log(path);
        console.log(data);
        document.getElementById('data_changes').innerHTML += JSON.stringify(data) + '<br>';
    };

    // Subscribe
    var path = 'animals/mammals';
    document.getElementById('log').innerHTML += 'Subscribing to ' + path + '<br>';

    subscribe(path,callback);

}, false);