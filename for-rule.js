const ospath = require('path');
const RuleSet = require('webpack/lib/RuleSet');

const moduleName = ospath.basename(__dirname);
const transformLoader = ospath.resolve(__dirname, './src/transformLoader.js');
const specLoader = ospath.resolve(__dirname, './src/specLoader.js');

const assertValidCall = (rule) => {
    if (rule && typeof rule === 'object') return;

    throw new Error([
        `the \`${moduleName}/for-rule\` function must be`,
        'called with a Webpack rule-configuration object'
    ].join(' '));
};

const assertIdentUsage = (ident, usage) => {
    if (usage[ident] !== true) return;

    throw new Error([
        'an `ident` can only be used once;',
        'set the options with a new `ident` before applying the',
        `\`${moduleName}/for-rule\` function again`
    ].join(' '));
};

const assertHaveOptions = (options) => {
    if (options && typeof options === 'object' && !Array.isArray(options)) return;

    throw new Error([
        `the options provided to \`${moduleName}/for-rule.options\``,
        'should be a simple object'
    ].join(' '));
};

const forRule = (context) => {
    if (!context) context = { options: {}, usage: {} };

    const prepareRule = (rule) => {
        assertValidCall(rule);
        
        const ident = context.options.ident;
        if (ident) {
            assertIdentUsage(ident, context.usage);
            context.usage[ident] = true;
        }
    
        return RuleSet.normalizeRule(rule, {}, 'resolve-imports');
    };

    const setOptions = (options) => {
        assertHaveOptions(options);
        return forRule({ options, usage: context.usage });
    };

    const transformRuleImpl = (rule, arrayFn) => {
        if (Array.isArray(rule))
            return rule.map(r => transformRuleImpl(r, arrayFn));
        
        rule = prepareRule(rule);
        const useEntries = rule.use || [];
        const subRules = rule.rules || [];

        useEntries[arrayFn]({
            loader: transformLoader,
            options: Object.assign({}, context.options, { viaForRule: true })
        });

        subRules.push({
            type: 'json',
            resourceQuery: /resolve-imports-spec-loader/,
            use: [{ loader: specLoader }]
        });

        rule.use = useEntries;
        rule.rules = subRules;

        return rule;
    };

    const transformRule = (rule) => transformRuleImpl(rule, 'unshift');
    transformRule.before = (rule) => transformRuleImpl(rule, 'unshift');
    transformRule.after = (rule) => transformRuleImpl(rule, 'push');
    transformRule.options = setOptions;

    return transformRule;
};

module.exports = forRule();