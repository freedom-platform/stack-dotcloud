
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("sm/node_modules/sm-util/lib/fs");
const UTIL = require("sm/node_modules/sm-util/lib/util");
const OS = require("sm/node_modules/sm-util/lib/os");
const WAITFOR = require("sm/node_modules/sm-util/lib/wait-for");
const JSON_STORE = require("sm/node_modules/sm-util/lib/json-store");
const PINF = require("sm/node_modules/pinf").for(module, "github.com/freedom-platform/stack-dotcloud/0");
const SM = require("sm");
const YAMLJS = require("yamljs");
const EXEC = require("child_process").exec;
const COMMANDER = require("commander");


exports.main = function(callback) {

	var programConfig = PINF.config();
	var programPath = PATH.dirname(programConfig.pinf.paths.program);
	var distPath = PATH.join(programPath, "dist");
	if (PINF.parent()) {
		distPath = PATH.join(PINF.parent().config().pinf.paths.package, "dist");
	}

	var sm = SM.for(programPath);

    var dotcloudConfig = false;

	var program = new COMMANDER.Command();
	program
		.version(JSON.parse(FS.readFileSync(PATH.join(__dirname, "package.json"))).version);
	program
		.command("deploy")
        .action(function(path, options) {
			return exportSource(function(err) {
				if (err) return callback(err);

				return loadConfig(function(err) {
					if (err) return callback(err);

					return copyDefaultFiles(function(err) {
						if (err) return callback(err);

						return writeCredentials(function(err) {
							if (err) return callback(err);

							return linkConfig(function(err) {
								if (err) return callback(err);

								return ensureProvisioned(function(err) {
									if (err) return callback(err);

									return publish(function(err) {
										if (err) return callback(err);

										return callback(null);
									});
								});
							});
						});
					});
				});
			});
        });
	// TODO: on `start-workspace` use freedom-platform/dev-darwin (supervisor) to keep `run` processes running.
	program
		.command("run")
        .action(function() {
			// TODO: If already running as part of `start-workspace`, re-start processes.
			return loadConfig(function(err) {
				if (err) return callback(err);
				var wait = WAITFOR.parallel(callback);
	        	// NOTE: We run
				for (var serviceName in dotcloudConfig) {
					wait(serviceName, function(serviceName, done) {
						if (dotcloudConfig[serviceName].type === "nodejs") {
							return SM.for(PATH.join(programPath, dotcloudConfig[serviceName].approot)).run(function(err) {
								if (err) return done(err);
								return done();
							});
							return done();
						} else {
							// TODO: Start other services inline.
						}
						return done();
					});
				}
				return wait();
			});
        });

    function normalizeAppRoot(path) {
    	if (/^\//.test(path)) {
    		if (path.substring(0, programPath.length) !== programPath) {
    			throw new Error("`approot` path '" + path + "' must be within program '" + programPath + "'");
    		}
			return path.substring(programPath.length + 1);
		}
		return path;
    }

	function exportSource(callback) {
		if (FS.existsSync(PATH.join(distPath, "dotcloud"))) {
			FS.removeSync(PATH.join(distPath, "dotcloud"));
		}
		return sm.export(PATH.join(distPath, "source"), {
			delete: true,
			includeDependencies: programConfig.options.pushDependencies || false
		}, function(err) {
			if (err) return callback(err);
			return FS.copy(PATH.join(distPath, "source"), PATH.join(distPath, "dotcloud"), function(err) {
				if (err) return callback(err);
				return callback(null);
			});
		});
	}

	function loadConfig(callback) {
		if (programConfig.services) {
			dotcloudConfig = programConfig.services;
			var wait = WAITFOR.serial(callback);
			for (var serviceName in dotcloudConfig) {
				wait(serviceName, function(serviceName, done) {
					ASSERT(typeof dotcloudConfig[serviceName].approot === "string", "`approot` config property must be set for service '" + serviceName+ "'");
					dotcloudConfig[serviceName].approot = normalizeAppRoot(dotcloudConfig[serviceName].approot);
					if (dotcloudConfig[serviceName].type === "nodejs") {
						if (!dotcloudConfig[serviceName].config) {
							dotcloudConfig[serviceName].config = {
								"node_version": "v0.8.x"
							};
						}
						return done();
					} else {
						return done(new Error("Service type '" + dotcloudConfig[serviceName].type + "' not yet supported!"));
					}
				});
			}
			return wait();
		} else {
			try {
				dotcloudConfig = YAMLJS.parse(FS.readFileSync(PATH.join(__dirname, "default/dotcloud.yml")).toString());
				return callback(null);
			} catch(err) {
				return callback(err);
			}
		}
	}

	function copyDefaultFiles(callback) {
		return sm.status(null, function(err, status) {
			if (err) return callback(err);
			function copyDir(fromPath, toPath, callback) {
				return FS.copy2(fromPath, toPath, {
					filter: function(path) {
						path =  path.substring(fromPath.length + 1);
						if (!path) return true;
						// Don't copy any directories.
						if (FS.statSync(PATH.join(fromPath, path)).isDirectory()) return false;
						if (FS.existsSync(PATH.join(toPath, path))) {
							if (/\.json$/.test(path)) {
								try {
									var json = JSON.parse(FS.readFileSync(PATH.join(toPath, path)));
									json = UTIL.deepMerge(json, JSON.parse(FS.readFileSync(PATH.join(fromPath, path))));
									FS.writeFileSync(PATH.join(toPath, path), JSON.stringify(json, null, 4));
								} catch(err) {
									return callback(err);
								}
							}
							return false;
						} else
						if (path === "dotcloud.yml" && dotcloudConfig) {
							FS.writeFileSync(PATH.join(toPath, path), YAMLJS.stringify(dotcloudConfig, 5, 4));
							return false;
						} else
						if (path === ".Makefile") {
							var content = FS.readFileSync(PATH.join(fromPath, path)).toString();
							if (process.env.PINF_DEBUG) {
								content = content.replace(/(export PINF_DEBUG:=)\n/, "$1" + process.env.PINF_DEBUG + "\n");
							}
							if (process.env.PINF_VERBOSE) {
								content = content.replace(/(export PINF_VERBOSE:=)\n/, "$1" + process.env.PINF_VERBOSE + "\n");
							}
							FS.writeFileSync(PATH.join(toPath, path), content);
							return false;
						}
						return true;
					}
				}, callback);
			}
			return copyDir(PATH.join(__dirname, "default"), PATH.join(distPath, "dotcloud"), function(err) {
				if (err) return callback(err);

				function copyApps(callback) {
					var wait = WAITFOR.serial(callback);
					for (var serviceName in dotcloudConfig) {
						wait(serviceName, function(serviceName, done) {
							var appRoot = dotcloudConfig[serviceName].approot;
							return copyDir(
								PATH.join(__dirname, "default/app", dotcloudConfig[serviceName].type),
								PATH.join(distPath, "dotcloud", appRoot),
								function(err) {
									if (err) return done(err);
									FS.writeFileSync(PATH.join(distPath, "dotcloud", appRoot, ".program.json"), JSON.stringify({
										"extends": [
											appRoot.split("/").map(function() {
												return "..";
											}).join("/") + "/.program.json"
										]
									}, null, 4));
									// If we have a `node_modules/` we rename it for the push so that dotcloud does not
									// replace it with its own.
									if (FS.existsSync(PATH.join(distPath, "dotcloud", appRoot, "node_modules"))) {
										FS.renameSync(
											PATH.join(distPath, "dotcloud", appRoot, "node_modules"),
											PATH.join(distPath, "dotcloud", appRoot, "_node_modules")
										)
									}
									/*
									// TODO: This should not be needed.
									// NOTE: `extends` in program.json for app will always point to TOP `program.json`.
									var descriptor = new JSON_STORE.JsonStore(PATH.join(distPath, "dotcloud", appRoot, "program.json"));
									if (descriptor.has(["extends"])) {
										var paths = descriptor.get(["extends"]);
										paths.forEach(function(path, index) {
											if (!/^\./.test(path)) return;
											if (!/^\.\./.test(PATH.dirname(path))) return;
											// Adjust extends for app in case we are using package that contains app as a dependency.
											paths[index] = appRoot.split("/").map(function() {
												return "..";
											}).join("/") + "/" + PATH.basename(path);
										});
										descriptor.set(["extends"], paths);
									}
									*/
									return done();
								}
							);
						});
					}
					return wait();
				}

				if (PINF.parent()) {
					var json = JSON.parse(FS.readFileSync(PATH.join(distPath, "dotcloud/.program.json")));
					json.config = UTIL.deepMerge(json.config || {}, PINF.parent()._descriptor.config || {});
					// TODO: Also merge `json.env`. Before we can do that we have to change
					//		 `["<-", "../environment.json"]` to `{"$__INJECT[../environment.json]": ""}`
					FS.writeFileSync(PATH.join(distPath, "dotcloud/.program.json"), JSON.stringify(json, null, 4));
				}

				if (programConfig.options.pushSm) {
					if (!FS.existsSync(PATH.join(distPath, "dotcloud/node_modules/sm"))) {
						if (typeof process.env.SM_HOME === "undefined") {
							return callback(new Error("`SM_HOME` environment variable must be set when using `options.pushSm`"));
						}
						console.log("Exporting '" + PATH.join(process.env.SM_HOME, "node_modules/sm") + "' to '" + PATH.join(distPath, "dotcloud/node_modules/sm") + "'.");
						return SM.for(PATH.join(process.env.SM_HOME, "node_modules/sm")).export(PATH.join(distPath, "dotcloud/node_modules/sm"), {
							delete: false
						}, function(err) {
							if (err) return callback(err);
							return copyApps(callback);
						});
					}
				} else
				if (!status.children["sm"]) {
					try {
						var ns = ["dependencies", "sm"];
						var descriptor = new JSON_STORE.JsonStore(PATH.join(distPath, "dotcloud/package.json"));
						if (!descriptor.has(ns)) {
							descriptor.set(ns, JSON.parse(FS.readFileSync(PATH.join(__dirname, "package.json"))).dependencies.sm);
						}
					} catch(err) {
						return callback(err);
					}
				}
				return copyApps(callback);
			});
		});
	}

	function writeCredentials(callback) {
		var ns = ["credentials", "github.com/sourcemint/sm-plugin-github/0", "api"];
		var descriptor = new JSON_STORE.JsonStore(PATH.join(distPath, "dotcloud/.program.json"));
		if (!descriptor.has(ns)) {
			return sm.getCredentials(["github.com/sourcemint/sm-plugin-github/0", "api"]).then(function(credentials) {
				descriptor.set(ns, credentials);
				return callback(null);
			});
		} else {
			return callback(null);
		}
	}

	function linkConfig(callback) {
		var basePath = programPath;
		if (PINF.parent()) {
			basePath = PINF.parent().config().pinf.paths.package;
		}
		var path = PATH.join(basePath, ".dotcloud");
		if (!FS.existsSync(path)) {
			FS.mkdir(path);
		}
		FS.symlinkSync("../../.dotcloud", PATH.join(distPath, "dotcloud/.dotcloud"));
		return callback(null);
	}

	function ensureProvisioned(callback) {
		try {
			var name = programConfig.name || "test";
			ASSERT(typeof name === "string", "`name` config property must be set");
			var basePath = programPath;
			if (PINF.parent()) {
				basePath = PINF.parent().config().pinf.paths.package;
			}
			var path = PATH.join(basePath, ".dotcloud/config");
			if (FS.existsSync(path)) {
				var config = JSON.parse(FS.readFileSync(path));
				if (config.application !== name) {
					return callback(new Error("Provisioned application name '" + config.application + "' does not match declared '" + name + "'. Delete '" + path + "' and try again."));
				}
				return callback(null);
			}
		} catch(err) {
			return callback(err);
		}
		var args = [];
		if (programConfig.flavor && [
			"live",
			"sandbox"
		].indexOf(programConfig.flavor) !== -1) {
			args.push(programConfig.flavor);
		} else {
			args.push("sandbox");
		}
		args.push(name);

		// @see https://github.com/dotcloud/dotcloud-cli/issues/31
		// TODO: Add `yes |` in `./dotcloud-create` and see why script does not exit.
/*
		var env = UTIL.copy(process.env);
		env.PWD = PATH.join(distPath, "dotcloud");
		var command = PATH.join(__dirname, "dotcloud-create") + " " + args.join(" ");
console.log("provision", command);
		return EXEC(command, {
			cwd: env.PWD,
			env: env
		}, function(error, stdout, stderr) {
console.log("error", error);			
	    	console.error(stdout);
	    	console.error(stderr);
			if (error) {
		        return callback(new Error("Error running os command: " + command));
			}
			return callback(null);
		});
*/
/*
var args = [ "create" ];
if (programConfig.flavor && [
	"live",
	"sandbox"
].indexOf(programConfig.flavor) !== -1) {
	args.push("-f", programConfig.flavor);
} else {
	args.push("-f", "sandbox");
}
args.push(name);
// TODO: https://github.com/dotcloud/dotcloud-cli/issues/31
return OS.spawnInline("dotcloud", args, {
	cwd: PATH.join(programPath, "dist/dotcloud"),
	env: {
		PWD: PATH.join(programPath, "dist/dotcloud")
	}
}).then(function() {
	return callback(null);
}).fail(callback);
*/
		return OS.spawnInline(PATH.join(__dirname, "bin/dotcloud-create"), args, {
			cwd: PATH.join(distPath, "dotcloud"),
			env: {
				PWD: PATH.join(distPath, "dotcloud")
			}
		}).then(function() {
			return callback(null);
		}).fail(callback);
	}

	function publish(callback) {
		// TODO: Call `sm publish` and set `package.json ~ pm = "dotcloud"`.
		return OS.spawnInline("dotcloud", [
			"push"
		], {
			cwd: PATH.join(distPath, "dotcloud"),
			env: {
				PWD: PATH.join(distPath, "dotcloud")
			}
		}).then(function() {
			return callback(null);
		}).fail(callback);
	}

	program.parse(process.argv);
}


if (require.main === module) {
	PINF.run(exports.main);
}
