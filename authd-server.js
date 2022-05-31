'use strict';
// Imports

const webdav = require('webdav-server').v2;

const usermgr = new webdav.SimpleUserManager();
const u1 = usermgr.addUser('linus', 'pass', false);
const u2 = usermgr.addUser('admin', 'admin', false);

const privmgr = new webdav.SimplePathPrivilegeManager();
privmgr.setRights(u2, '/', ['all']);
privmgr.setRights(u1, '/linus', ['all']);



const server = new webdav.WebDAVServer({
	httpAuthentication: new webdav.HTTPDigestAuthentication(usermgr, 'Default realm'),
	privilegeManager: privmgr,
	port: 1900,
	autoSave: {
		treeFilePath: 'data.json'
	}
});

server.autoLoad(e => {
	if (e) server.rootFileSystem().addSubTree(server.createExternalContext(), {
		dir1: {
			'txt.txt': webdav.ResourceType.File,
			'jpg.jpg': webdav.ResourceType.File,
		},
		blank: webdav.ResourceType.File
	});
	a();
});

let customFS
function cb_(){}
server.setFileSystem('/subfolder', customFS, cb_);

server.afterRequest((arg, next) => {
	console.log('=>', arg.request.method, arg.requested.uri, '>', arg.response.statusCode, arg.response.statusMessage);
	console.log(arg.responseBody);
	next();
});

var a = _ => server.start(() => console.log('Started server'));

