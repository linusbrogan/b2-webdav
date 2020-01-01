const webdav = require('webdav-server').v2;
const {B2FileSystem} = require('./B2FileSystem.js');

// Expect account ID and application key as environment variables
const auth = {
	accountId: process.env.B2_ACCOUNT_ID,
	applicationKey: process.env.B2_APPLICATION_KEY
};
const b2fs = new B2FileSystem(auth, console.log);
const server = new webdav.WebDAVServer({port: 80});
server.setFileSystem('/', b2fs, true, success => {
	if (success) server.start(server => console.log('WebDAV server started, bound to: ', server.address()));
});
