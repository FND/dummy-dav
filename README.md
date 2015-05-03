mock WebDAV implementation for development purposes

supports `GET` (incl. ETags), `PUT` and `PROPFIND`

NB: This is not intended for serious use!

    $ npm install "git+https://github.com/FND/dummy-dav.git"
    $ node_modules/.bin/dummy-dav [port [host]]
