import theFirstFunc from './myFirstFunc';
import defaultFirstFunc from './defaultExport';
import { default as byNameDefaultImportFunc } from './myFirstFunc';
import { mySecondFunc } from './mySecondFunc';
import { myExportedSecondFunc } from './reexport';
import { FOO } from './constants';
import * as things from './constants';
import { myExportedSecondFunc as webpackLoadedFunc } from 'my-loader!./reexport';
import transformedCss from './styles.css';
import inlineLoaderCss from 'style-loader!css-loader?modules!./styles.css';
import queryParamsCss from './styles.css?as-js';

export { default as byNameDefaultExportFunc } from './myFirstFunc';
export { default as byNameDefaultNestedFunc } from './defaultExport';
export { myInlineFirstFunc as theInlineFirstFunc } from './reexport';

// export-from an un-aliased function multiple times
export { myThirdFunc } from './reexport';

// confusingly named export
export { myExportedSecondFunc as FOO } from './reexport';

// side-effecting export
export { FOO as sideEffectFoo } from './sideEffects';

// namespaced export-from
export * as thungs from './constants';

export {
    theFirstFunc,
    mySecondFunc as theSecondFunc,
    byNameDefaultImportFunc,
    myExportedSecondFunc as theExportedSecondFunc,
    defaultFirstFunc,
    things as thangs,
    webpackLoadedFunc,
    transformedCss,
    inlineLoaderCss,
    queryParamsCss,
};

export default () => console.log('default export');
