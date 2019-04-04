const debugModule = require('debug');
const util = require('util');

const debugBase = debugModule(require('./constants').loaderName);
const debugPending = debugBase.extend('pending');

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
    v = v.map(el => `    ${util.inspect(el, this.inspectOpts).replace(/\n/g, '\n     ')},`);
    return [].concat('[', ...v, ']').join('\n');
};

/**
 * The shared contexts cache.
 * 
 * @type {WeakMap.<*, SharedContext}
 */
const contexts = new WeakMap();

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
    
        if (contexts.size === 0 || report.pendingResources.length === 0)
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

module.exports = { debugBase, contexts, report };