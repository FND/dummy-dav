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
	var filename = determinePath(req.url);
	fs.readFile(filename, function(err, contents) {
		if(err) {
			res.writeHead(404, "Not Found");
			res.end("failed to read file\n");
		} else {
			var etag = crypto.createHash("md5");
			etag.update(contents);
			res.writeHead(200, "OK", {
				ETag: etag.digest("hex")
			}); // TODO: Content-Type
			res.end(contents); // TODO: encoding?
		}
	});
}

function writeFile(req, res) {
	var filename = determinePath(req.url);

	var chunks = [];
	req.on("data", function(chunk) { // TODO: Content-Length support
		chunks.push(chunk);
		if(chunks.length > 1e6) { // >1 MB; assume misbehaved client
			req.connection.destroy();
		}
	});
	req.on("end", function() {
		fs.writeFile(filename, Buffer.concat(chunks), function(err) {
			if(err) {
				res.writeHead(400, "Bad Request");
				res.end("failed to write file\n");
			} else {
				res.writeHead(204, "OK", { "Content-Type": "text/plain" });
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

function determinePath(uri) {
	uri = uri.split("?")[0]; // discard query string
	uri = uri.replace(/^\//, ""); // strip leading slash
	var filepath = uri.split("/").map(decodeURIComponent); // XXX: misleading name; also works for directories
	filepath = path.join.apply(path, filepath);
	return filepath;
}
