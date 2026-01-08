"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
function myTsFunction(ctx, { inputs, outputs, env, }) {
    return __awaiter(this, void 0, void 0, function* () {
        ctx.logger.info('Running my custom TS function');
        ctx.logger.info(`Hello, ${inputs.name.value}!}`);
        ctx.logger.info(`Your number is ${inputs.num.value}`);
        ctx.logger.info(`Your object is ${JSON.stringify(inputs.obj.value)}`);
        ctx.logger.info('Done running my custom TS function');
        ctx.logger.warn('Warning from my custom TS function');
        ctx.logger.error('Error from my custom TS function');
        ctx.logger.info('Running a command');
        ctx.logger.debug('Debugging a command');
        ctx.logger.fatal('Fatal error from my custom TS function');
        ctx.logger.info('Setting outputs');
        outputs.name.set('Brent');
        outputs.num.set('123');
        outputs.obj.set(JSON.stringify({ foo: 'bar' })); // TODO: add support for other types of outputs then string
        ctx.logger.info('Setting env vars');
        env['MY_ENV_VAR'] = 'my-value';
    });
}
exports.default = myTsFunction;
