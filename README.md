# b2-webdav

A [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html) file system for webdav-server

## Usage

The `B2FileSystem` constructor expects an authentication object containing an account ID and application key from B2 scoped to a single bucket.
There is an example server using `B2FileSystem` in `example-server.js`.