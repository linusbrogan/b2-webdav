const webdav = require('webdav-server').v2;
const {B2FileSystem, B2Serializer} = require('./B2FileSystem.js');

const auth = {
	accountId: process.env.CF_ACCOUNT_ID,
	applicationKey: process.env.CF_APPLICATION_KEY
};
let b2fs = new B2FileSystem(auth, console.log);
const autoSave = {
	treeFilePath: './tree',
	tempTreeFilePath: './tree.tmp'
}
const autoLoad = {
	serializers: [new B2Serializer(true)]
};

const server = new webdav.WebDAVServer({
//	autoLoad,
//	autoSave,
	port: Number(process.env.PORT) || 61900,
	serverName: 'b2-webdav/0.1.0'
});
const debug = true;
if (debug) server.beforeRequest((req, next) => {
	console.log('REQUEST::', req, req.requested);
	next();
});
server.setFileSystem('/', b2fs, true, success => {
	if (success) server.start(server => console.log('WebDAV server started, bound to: ', server.address()));
});

//const {HTTPBasicAuthentication, PrivilegeManager, VirtualFileSystem} = webdav;


/*
const server = new webdav.WebDAVServer({
	autoLoad: null, //load saved state
	autoSave: null, // manage state
	enablelocationTag: false, //<DAV:location> in PROPFIND, breaks osx
	httpAuthentication: new HTTPBasicAuthentication('default realm'), // authentication manager
	lockTimeout: 3600, // timeout in seconds
	maxRequestDepth: Infinity, // how far to recursively apply operations
	port: 61900, // listen on
	privilegeManager: new PrivilegeManager(), // control user privileges
	requireAuthentification: true, // require auth
	rootFileSystem: new VirtualFileSystem(), // fs
	serverName: 'b2-webdav', // name in Server header
	storageManager: new NoStorageManager() || new PerUserStorageManager(), // manage storage or per user
	strictMode: false, // allow poorly formed requests
	version: '0.1.0' // version in Server header
});

//server.method('METHOD', new HTTPMethod())
//server.methods has list of suppoerted methods
//server.onUnknownMethod(myNoMethod)
server.beforeRequest((context, next) => {
	if (context.requested.uri.indexof('/') !== 0) {
		context.setCode(400);
		context.exit();
	} else next(); // call exactly one of next or ctx.exit, async is fine. ONCE!
});
server.afterRequest((ctx, next) => {
	console.log(ctx);
	next();
});*/