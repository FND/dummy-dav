#!/usr/bin/env node

var http = require("http");
var dispatch = require("./index");

var args = process.argv.slice(2);
var host = args[1] || "localhost";
var port = args[0] || 8000;

console.log("→ http://" + host + ":" + port);
http.createServer(dispatch).listen(port, host);
