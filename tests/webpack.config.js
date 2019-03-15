const path = require('path');

module.exports = {
    resolve: {
        modules: [
            path.resolve(__dirname),
            // force resolution to search the test's node_modules folder
            path.resolve(__dirname, './node_modules'),
        ],
    },
};
