const debugModule = require('debug');
const nodeUtil = require('util');

const debugBase = debugModule(require('./constants').loaderName);
const debugPending = debugBase.extend('pending');

/**
 * @callback DebugFunction
 * @param {...*} args
 * The arguments to log.  When the first argument is a string, any
 * other arguments can be integrated into the string through
 * `printf` style formatters.
 */

/**
 * @typedef DebugProps
 * @prop {boolean} enabled
 * Whether the debug instance is enabled.
 * @prop {function(string): Debug} extend
 * Extends the debug function with a new namespace.
 */

/** @typedef {DebugFunction & DebugProps} Debug */

/**
 * A custom debug formatter for arrays.
 * 
 * @param {*} v Any value, but best as an array.
 * @returns {string} The inspection output of `v`.
 */
debugModule.formatters.A = function arrayDebugFormatter(v) {
    if (!Array.isArray(v)) return debugModule.formatters.O(v);
    if (v.length === 0) return '[]';

    this.inspectOpts.colors = this.useColors;
    v = v.map(el => `    ${nodeUtil.inspect(el, this.inspectOpts).replace(/\n/g, '\n     ')},`);
    return [].concat('[', ...v, ']').join('\n');
};

/** Provides debug infrastructure for debugging deadlocks. */
const report = {
    timeoutHandle: null,
    pendingResources: [],
    registerLoader(request) {
        if (!debugPending.enabled) return;
        report.pendingResources.push(request);
    },
    unregisterLoader(request) {
        if (!debugPending.enabled) return;
        for (let i = report.pendingResources.length - 1; i >= 0; i -= 1)
            if (report.pendingResources[i] === request)
                return report.pendingResources[i] = null;
    },
    reportPendingLoaders() {
        report.timeoutHandle = null;
        report.pendingResources = report.pendingResources.filter(Boolean);
    
        if (report.pendingResources.length === 0)
            debugPending('NOTHING PENDING');
        else
            debugPending('AWAITING %A', report.pendingResources);
    },
    startReportPendingLoaders() {
        if (!debugPending.enabled) return;
        if (report.timeoutHandle) clearTimeout(report.timeoutHandle);
        report.timeoutHandle = setTimeout(report.reportPendingLoaders, 10000);
    }
};

module.exports = {
    debugBase,
    report
};