const fs = require('fs')
const os = require('os');
const Path = require('path');

const B2 = require('b2-cloud-storage');
const B2CloudStorage = B2;
const got = require('got');
const mime = require('mime-types');
const webdav = require('webdav-server').v2;

const MAX_AUTH_TRIES = 5;
const HEX = '0123456789abcdef';

class B2Serializer {
	serialize(fileSystem, callback) {
		callback(null, JSON.stringify(fileSystem.b2.auth));
	}
	uid() {
		return 'B2Serializer-0.1.0';
	}
	unserialize(auth, callback) {
		try {
			const fileSystem = new B2FileSystem(JSON.parse(auth));
			callback(null, fileSystem);
		} catch (error) {
			callback(error);
		}
	}
}

class B2FileSystem extends webdav.FileSystem {
	constructor(auth, onAuth = () => {}) {
		super(new B2Serializer());
		this.b2 = new B2({auth});
		this.$authorizeB2(onAuth);

		this.resources = {};
		this.useCache = true;
	}
	$authorizeB2(callback = () => {}, tries = 0) {
		this.b2.authorize((error, data) => {
			if (tries > MAX_AUTH_TRIES) throw new Error('Could not authorize to B2');
			if (error) return this.$authorizeB2(callback, tries + 1);
			if (auth.downloadUrl) data.downloadUrl = auth.downloadUrl;
			callback(data);
		});
	}
	$randomKey(length = 1) {
		let key = '';
		while (key.length < length) key += HEX[Math.floor(HEX.length * Math.random())];
		return key;
	}
	$getEmptyFile(callback) {
		this.$getTempDir((error, dir) => {
			const emptyFile = Path.join(dir, '.bzempty');
			fs.writeFile(emptyFile, '', {flag: 'w+'}, error => error ? callback(error) : callback(null, emptyFile));
		});
	}
	$getTempDir(callback) {
		const cacheDir = Path.join(os.tmpdir(), 'b2fs-cache', (new Date).toISOString().substr(0, 10), this.$randomKey(8));
		fs.mkdir(cacheDir, {recursive: true}, error => error ? callback(error) : callback(null, cacheDir));
	}
	$getRemotePath(path) { // What happens with .bzempty?
		let pathStr = String(path).split('*')[0];
		if (pathStr[0] == '/') pathStr = pathStr.substr(1);
		return pathStr == '/' ? '' : pathStr;
	}
	$getMetaData(path, callback) {
		const key = String(path);
		if (this.useCache && this.resources[key] && this.resources[key].metadata)
			return void callback(null, this.resources[key].metadata);
		else if (path.isRoot()) {
			const metadata = {
				action: 'folder',
				contentLength: 0,
				contentSha1: null,
				contentType: null,
				fileId: null,
				fileInfo: {},
				fileName: ''
			};
			if (!this.resources[key]) this.resources[key] = {};
			this.resources[key].metadata = metadata;
			return void callback(null, metadata);
		} else {
			const remotePath = this.$getRemotePath(path);
			if (!remotePath) return this.$getMetaData(new webdav.Path('/'), callback);
			this.$getBucket(({bucketId}) => this.b2.listFileNames({
				bucketId,
				startFileName: remotePath,
				maxFileCount: 2, // Could get more
				prefix: remotePath,
				delimiter: '/'
			}, (error, data) => {
				if (error) return callback(webdav.Errors.ResourceNotFound);
				const files = data.files.filter(({fileName}) => fileName == remotePath || fileName == `${remotePath}/`); // this might be optional
				if (!files.length) return callback(webdav.Errors.ResourceNotFound, new Error('NO FILES'));
				let [metadata, dir] = files;
				if (dir) metadata = Object.assign({}, dir, metadata, {action: 'hybrid'});
				if (!this.resources[key]) this.resources[key] = {};
				this.resources[key].metadata = metadata;
				callback(null, metadata);
			}));
		}
	}
	_rename(...args) {
		this._move(...args);
	}
	_create(path, ctx, callback) {
		const fileName = this.$getRemotePath(path);
		if (ctx.type.isDirectory) fileName = Path.posix.join(fileName, '.bzempty');
		this.$getEmptyFile((error, empty) => {
			if (error) return callback(error);
			this.$getBucket(({bucketId}) => {
				this.b2.uploadFile(empty, {
					bucketId,
					fileName: encodeURI(fileName),
					contentType: 'placeholder/placeholder',
				}, (error, data) => {
					callback(error);
				});
			});
		});
	}
	_delete(path, ctx, callback) {
		delete this.resources[String(path)];
		this.$getBucket(({bucketId}) => this.b2.hideFile({
			bucketId,
			fileName: this.$getRemotePath(path)
		}, (error, data) => callback(error && webdav.Errors.InvalidOperation)));
	}
	_openWriteStream(path, ctx, callback) {
		this.$getMetaData(path, (error, data) => {
			if (error) return callback(webdav.Errors.ResourceNotFound);
			this.$getTempDir((error, dir) => {
				if (error) return callback(error);
				const fsPath = Path.join(dir, this.$randomKey(8));
				const stream = fs.createWriteStream(fsPath);
				stream.on('finish', () => this.$getBucket(({bucketId}) => this.b2.uploadFile(fsPath, {
					bucketId,
					fileName: this.$getRemotePath(path),
					contentType: mime.lookup(this.$getRemotePath(path)) || 'application/octet-stream'
				}, (error, data) => fs.unlink(fsPath, error => null))));
				callback(null, stream);
			});
		});
	}
	_openReadStream(path, ctx, callback) {
		const key = String(path);
		if (this.resources[key] && this.resources[key].fsPath) {
			fs.open(this.resources[key].fsPath, (error, fd) => {
				if (error) {
					delete this.resources[key].fsPath;
					this._openReadStream(path, ctx, callback);
				} else callback(null, fs.createReadStream(this.resources[key].fsPath, {fd}));
			});
		} else this.$getBucket(({bucketName}) => {
			const url = `${this.b2.authData.downloadUrl}/file/${bucketName}/${this.$getRemotePath(path)}`;
			const opts = {
				headers: {Authorization: this.b2.authData.authorizationToken},
				stream: true
			};
			this.$getTempDir((error, dir) => {
				if (error) return callback(error);
				const fsPath = Path.join(dir, this.$randomKey(8));
				let setHeaders = null;
				const _headers = new Promise((resolve, reject) => {
					setHeaders = resolve;
				});
				const download = got.stream(url, opts);
				download.on('response', response => {
					const {statusCode, headers} = response;
					if (statusCode >= 200 && statusCode < 300) setHeaders(headers);
					else throw new Error('Bad Response from B2');
				}).on('error', (error, body, response) => {
					callback(webdav.Errors.ResourceNotFound);
				}).pipe(fs.createWriteStream(fsPath)).on('finish', () => {
					const hashStream = fs.createReadStream(fsPath);
					this.b2.getHash(hashStream, async (error, fileHash) => {
						const b2Hash = (await _headers)['x-bz-content-sha1'].toLowerCase();
						if (b2Hash != fileHash.toLowerCase()) return callback(error);
						if (!this.resources[key]) this.resources[key] = {};
						this.resources[key].fsPath = fsPath;
						this.resources[key].hash = b2Hash;
						callback(null, fs.createReadStream(fsPath));
					});
				}).on('error', error => callback(webdav.Errors.ResourceNotFound));
			});
		});
	}
	_size(path, ctx, callback) {
		const key = String(path);
		const resource = this.resources[key];
		if (resource && resource.metadata) callback(null, resource.metadata.contentLength);
		else this.$getMetaData(path, (error, data) => {
			if (error) callback(webdav.Errors.ResourceNotFound);
			else this._size(path, ctx, callback);
		});
	}
	_lockManager(path, ctx, callback) {
		this.$getMetaData(path, (error, data) => {
			const key = String(path);
			if (error) return callback(webdav.Errors.ResourceNotFound);
			if (!this.resources[key].locks) this.resources[key].locks = new webdav.LocalLockManager();
			callback(null, this.resources[key].locks);
		});
	}
	_propertyManager(path, ctx, callback) {
		this.$getMetaData(path, (error, data) => {
			const key = String(path);
			if (error) return callback(webdav.Errors.ResourceNotFound);
			if (!this.resources[key].props) this.resources[key].props = new webdav.LocalPropertyManager({});
			callback(null, this.resources[key].props);
		});
	}
	$listFiles(options, callback, list = []) {
		this.b2.listFileNames(options, (error, data) => {
			if (error) return callback(error);
			const {files, nextFileName} = data;
			list = [...list, ...files];
			if (nextFileName) this.$listFiles(Object.assign({}, options, {startFileName: nextFileName}), callback, list);
			else callback(null, list);
		});
	}
	_readDir(path, ctx, callback) {
		this.$getBucket(({bucketId}) => this.$listFiles({
			bucketId,
			maxFileCount: 10000,
			prefix: this.$getRemotePath(path),
			delimiter: '/'
		}, (error, files) => {
			if (error) return callback(webdav.Errors.ResourceNotFound);
			callback(null, files.map(({fileName}) => fileName)); // Is this the right format?
		}));
	}
	_creationDate(path, ctx, callback) {
		this._lastModifiedDate(path, ctx, callback);
	}
	_lastModifiedDate(path, ctx, callback) {
		this.$getMetaData(path, (error, data) => {
			if (error) return callback(webdav.Errors.ResourceNotFound);
			let date = Number(data.fileInfo.src_last_modified_millis);
			if (isNaN(date)) date = Date.now();
			callback(null, date);
		});
	}
	_type(path, ctx, callback) {
		const key = String(path);
		if (this.useCache && this.resources[key] && this.resources[key].type)
			callback(null, this.resources[key].type);
		else this.$getMetaData(path, (error, data) => {
			if (error) return callback(webdav.Errors.ResourceNotFound);
			const {action} = data;
			let typeKey;
			if (action == 'folder') typeKey = 'Directory';
			else if (action == 'hybrid') typeKey = 'Hybrid';
			else if (action == 'upload') typeKey = 'File';
			else typeKey = 'NoResource';
			const type = webdav.ResourceType[typeKey];
			if (!this.resources[key]) this.resources[key] = {};
			this.resources[key].type = type;
			callback(null, type);
		});
	}
	_move(from, to, ctx, callback) {
		this._copy(from, to, ctx, (error, copied) => {
			if (error || !copied) callback(webdav.Errors.InvalidOperation, false);
			else this._delete(from, ctx, error => callback(error, !error));
		});
	}
	_copy(from, to, ctx, callback) {
		this.$getFileId(from, (error, sourceFileId) => {
			if (error) callback(error);
			else this.b2.copyFile({
				fileName: this.$getRemotePath(to),
				metadataDirective: 'COPY',
				sourceFileId,
				onUploadProgress: console.log
			}, (error, data) => callback(error, !error));
		});
	}
	$getBucket(callback) {
		const {allowed} = this.b2.authData || {};
		if (allowed) callback(allowed);
		else this.$authorizeB2(({allowed}) => callback(allowed));
	}
	$getFileId(path, callback) {
		const remotePath = this.$getRemotePath(path);
		const key = String(path);
		if (this.resources[key] && this.resources[key].metadata) return callback(null, this.resources[key].metadata.fileId);
		this.$getBucket(({bucketId}) => this.b2.listFileNames({
			bucketId,
			startFileName: remotePath,
			maxFileCount: 1000, // We could could grab more files without prefix to save on calls
			prefix: remotePath
		}, (error, data) => {
			if (error) return callback(error);
			// We could cache metadata so we don't have to lookup as much
			const [file] = data.files.filter(({fileName}) => fileName == remotePath);
			if (file) callback(null, file.fileId);
			else callback(webdav.Errors.ResourceNotFound);
		}));
	}
}

module.exports = {
	B2FileSystem,
	B2Serializer
};