// side-effecting export
export { FOO as sideEffectFoo } from './sideEffects';
export { FOO as loadedFoo } from 'val-loader!./valCode';