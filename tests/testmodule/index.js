import theFirstFunc from './myFirstFunc';
import { default as byNameDefaultImportFunc } from './myFirstFunc';
import { mySecondFunc } from './mySecondFunc';
import { myExportedSecondFunc } from './reexport';
import { FOO } from './constants';
import * as things from './constants';

export { default as byNameDefaultExportFunc } from './myFirstFunc';
export { myInlineFirstFunc as theInlineFirstFunc } from './reexport';

// export-from an un-aliased function multiple times
export { myThirdFunc } from './reexport';

// confusingly named export
export { myExportedSecondFunc as FOO } from './reexport';

export {
    theFirstFunc,
    mySecondFunc as theSecondFunc,
    byNameDefaultImportFunc,
    myExportedSecondFunc as theExportedSecondFunc,
    things as thangs,
};

export default () => console.log('default export');
