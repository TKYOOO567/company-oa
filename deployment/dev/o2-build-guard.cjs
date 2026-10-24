// The upstream module loop ignores shelljs.exec return values. Turn real child
// build failures into a failing build process without changing platform source.
const shelljs = require(require.resolve('shelljs', { paths: [process.cwd()] }))
shelljs.config.fatal = true
