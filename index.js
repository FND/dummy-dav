/*jslint vars: true, node: true, white: true */
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var handlers = {
	"PROPFIND": directoryIndex,
	"GET": readFile,
	"PUT": writeFile
};

module.exports = dispatch;

function dispatch(req, res) {
	var handler = handlers[req.method];
	if(handler) {
		handler.apply(this, arguments);
	} else {
		res.writeHead(405, "Method Not Allowed");
		res.end();
	}
}

function directoryIndex(req, res) {
	if(req.headers.depth !== "1") {
		res.writeHead(403, "Forbidden");
		res.end("PROPFIND requests are limited to `Depth: 1`\n");
		return;
	}

	var dirpath = determinePath(req.url);
	fs.readdir(dirpath, function(err, entries) {
		if(err) {
			res.writeHead(404, "Not Found");
			res.end("failed to read directory\n");
		} else {
			entries = entries.map(function(entry) {
				var entryPath = path.join(dirpath, entry);
				return new Promise(function(resolve, reject) {
					fs.stat(entryPath, function(err, stat) {
						if(err) {
							reject(err);
						} else {
							resolve({
								name: entry, // XXX: unused
								path: entryPath,
								dir: stat.isDirectory()
							});
						}
					});
				});
			});
			Promise.all(entries).then(function(entries) {
				res.writeHead(207, "Multi-Status");
				res.end(generateDirectoryIndex(entries));
			}).catch(function(errors) {
				console.error(errors);
				res.writeHead(500, "Internal Server Error");
				res.end();
			});
		}
	});
}

function readFile(req, res) {
	getFile(req.url, function(err, file) {
		if(err) {
			res.writeHead(404, "Not Found");
			res.end();
		} else {
			res.writeHead(200, "OK", { ETag: file.hash }); // TODO: Content-Type
			res.end(file.contents); // TODO: encoding?
		}
	});
}

function writeFile(req, res, filepath) {
	// validate ETag if present
	// TODO: require/support `If-None-Match: *` for newly created files?
	var etag = req.headers["if-match"];
	if(!filepath && etag) {
		getFile(req.url, function(err, file) {
			if(file.hash === etag) { // XXX: race condition for concurrent requests
				writeFile(req, res, file.path); // XXX: overloading; too implicit
			} else {
				res.writeHead(412, "Precondition Failed");
				res.end();
			}
		});
		return;
	}

	if(!filepath) {
		filepath = determinePath(req.url);
	}
	readInput(req, function(data) {
		fs.writeFile(filepath, data, function(err) {
			if(err) {
				res.writeHead(400, "Bad Request");
				res.end("failed to write file\n");
			} else {
				res.writeHead(204, "No Content");
				res.end();
			}
		});
	});
}

function generateDirectoryIndex(entries) {
	var responses = entries.map(function(entry) {
		if(entry.dir) {
			var props = "<propstat><prop><resourcetype><collection/>" +
					"</resourcetype></prop></propstat>";
		}
		return ["<response><status>HTTP/1.1 200 OK</status><href>", entry.path,
				"</href>", props, "</response>"].join("");
	});
	return ['<?xml version="1.0" encoding="utf-8"?><multistatus xmlns="DAV:">'].
		concat(responses, "</multistatus>").join("");
}

function getFile(uri, callback) { // TODO: rename
	var filepath = determinePath(uri);
	fs.readFile(filepath, function(err, contents) {
		if(err) {
			callback(new Error("failed to read file"), {
				path: filepath
			});
		} else {
			var hash = crypto.createHash("md5");
			hash.update(contents);
			callback(null, {
				path: filepath,
				hash: hash.digest("hex"),
				contents: contents
			});
		}
	});
}

function readInput(req, callback) {
	var chunks = [];
	req.on("data", function(chunk) { // TODO: Content-Length support
		chunks.push(chunk);
		if(chunks.length > 1e6) { // >1 MB; assume misbehaved client
			req.connection.destroy();
		}
	});
	req.on("end", function() {
		callback(Buffer.concat(chunks));
	});
}

function determinePath(uri) {
	uri = uri.split("?")[0]; // discard query string
	uri = uri.replace(/^\//, ""); // strip leading slash
	var filepath = uri.split("/").map(decodeURIComponent); // XXX: misleading name; also works for directories
	filepath = path.join.apply(path, filepath);
	return filepath;
}
