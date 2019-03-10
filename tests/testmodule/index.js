import myFunc from './myFunc';
import { myOtherOtherFunc } from './reexport';
import { FOO } from './constants';
import * as things from './constants';

export { myInlineFunc as myInlineExport } from './reexport';

// confusingly named export
export { myOtherOtherFunc as FOO } from './reexport';

export {
    myFunc,
    myOtherOtherFunc as myOtherFunc,
    things as thangs,
};

export default () => console.log('default export');
