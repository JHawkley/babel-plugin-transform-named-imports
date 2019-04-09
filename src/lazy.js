/**
 * @typedef Operation
 * @prop {$$} op
 * @prop {Function} [fn]
 */

/** @enum {Symbol} */
const $$ = {
    map: Symbol('map'),
    filter: Symbol('filter'),
    flat: Symbol('flat'),
    flatAll: Symbol('flatAll'),
    toMap: Symbol('toMap'),
    awaitEach: Symbol('await-each'),
    reject: Symbol('reject'),
    end: Symbol('end')
};

const notRejected = (v) => v !== $$.reject;
const clearRejects = (arr) => arr.filter(notRejected);
const defaultKeyFn = (v, oi, ni) => Array.isArray(v) && v.length === 2 ? v : [ni, v];

/**
 * @template T
 * @param {T[]} arr
 * @returns {function(): (T|$$#end)}
 */
const iterArray = (arr) => {
    const len = arr.length;
    let i = 0;

    return () => i >= len ? $$.end : arr[i++];
};

/**
 * @template T
 * @param {Iterable<T>} col
 * @returns {function(): (T|$$#end)}
 */
const iterObj = (col) => {
    const iterator = col[Symbol.iterator]();
    let result = iterator.next();

    return () => {
        if (result.done) $$.end;
        const value = result.value;
        result = iterator.next();
        return value;
    };
};

/**
 * @template T
 * @param {T} value
 * @returns {function(): (T|$$#end)}
 */
const iterOnly = (value) => {
    let done = false;

    return () => {
        if (done) return $$.end;
        done = true;
        return value;
    }
};

const isIterable = (obj) => obj && typeof obj[Symbol.iterator] === 'function';

/**
 * @template T
 * @param {Iterable<T>} col
 * @returns {function(): (T|$$#end)}
 */
const iterFor = (col) => (Array.isArray(col) ? iterArray : iterObj)(col);

const iterFlat = (col) => {
    const iterator = iterFor(col);
    let subIterator = null;

    return () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let value;
            if (subIterator) {
                value = subIterator();
                if (value !== $$.end) return value;
                subIterator = null;
            }

            value = iterator();
            if (!isIterable(value)) return value;
            subIterator = iterFlat(value);
        }
    };
}

/**
 * @param {function(): *} iterator
 * @param {Operation[]} ops
 * @param {number} [start=0]
 */
const performOps = (iterator, ops, start = 0, nIndex = 0) => {
    const len = ops.length;
    let subOps = null;

    return (oIndex) => {
        let value;

        // eslint-disable-next-line no-constant-condition
        iter: while (true) {

            if (subOps) {
                value = subOps(oIndex);
                if (value !== $$.end) {
                    nIndex += 1;
                    return value;
                }
                subOps = null;
            }

            value = iterator();
            if (value === $$.end) return $$.end;

            ops: for (let i = start; i < len; i++) {
                const { op, fn } = ops[i];
        
                switch (op) {
                    case $$.map:
                        value = fn(value, oIndex);
                        continue ops;

                    case $$.filter:
                        if (!fn(value, oIndex)) return $$.reject;
                        continue ops;

                    case $$.flat:
                        if (isIterable(value)) {
                            subOps = performOps(iterFor(value), ops, i + 1, nIndex);
                            continue iter;
                        }
                        continue ops;
                    
                    case $$.flatAll:
                        if (isIterable(value)) {
                            subOps = performOps(iterFlat(value), ops, i + 1, nIndex);
                            continue iter;
                        }
                        continue ops;

                    case $$.toMap:
                        value = fn(value, oIndex, nIndex);
                        continue ops;

                    case $$.awaitEach:
                        if (i + 1 >= len) return Promise.resolve(() => value);
                        return Promise.resolve(value).then(
                            v => ni => performOps(iterOnly(v), ops, i + 1, ni)(oIndex)
                        );
                }
            }

            nIndex += 1;
            return value;
        }
    };
};

const toArray = (iterator, ops) => {
    const result = [];
    const executing = performOps(iterator, ops);
    let oIndex = 0;
    let value = executing(oIndex);
    while (value !== $$.end) {
        oIndex += 1;
        if (value !== $$.reject) result.push(value);
        value = executing(oIndex);
    }
    return result;
};

/**
 * @template T
 * @param {Iterable<T>} collection
 */
module.exports = (collection) => {
    /** @type {Operation[]} */
    const operations = [];
    /** @type {function(): (T|$$#end)} */
    const iterator = (Array.isArray(collection) ? iterArray : iterObj)(collection);
    let async = false;

    const instance = {
        map: (fn) => (operations.push({ op: $$.map, fn }), instance),
        filter: (fn) => (operations.push({ op: $$.filter, fn }), instance),
        flat: () => (operations.push({ op: $$.flat }), instance),
        awaitEach: () => (operations.push({ op: $$.awaitEach }), async = true, instance),
        toArray: () => {
            const result = toArray(iterator, operations);

            if (!async) return result;
            return Promise.all(result).then(clearRejects);
        },
        toMap: (keyFn) => {
            if (!keyFn) keyFn = defaultKeyFn;
            const result = toArray(iterator, [...operations, { op: $$.toMap, fn: keyFn }]);
            if (!async) return new Map(result);
            return Promise.all(result).then(arr => new Map(arr));
        }
    };
};