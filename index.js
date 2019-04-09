const specLoader = require('path').resolve(__dirname, './src/specLoader');

module.exports = require('./src/transformLoader');

module.exports.specLoaderRule = {
    type: 'javascript/auto',
    resourceQuery: /resolve-imports-spec-loader/,
    use: [{ loader: specLoader }]
};