import * as Boom from '@hapi/boom';
import Router from 'koa-router';

export function boomify(err: Error): Boom.Boom {
  if (Boom.isBoom(err)) {
    return err;
  }
  return Boom.boomify(err);
}

export function boomHelper(ctx: Router.RouterContext, boomError: Boom.Boom): void {
  ctx.status = boomError.output.payload.statusCode;
  if (ctx.status === 400) {
    const validation =
      typeof boomError.data === 'string'
        ? [
            {
              message: boomError.output.payload.message,
              path: boomError.data,
              type: 'custom',
              context: { key: boomError.data },
            },
          ]
        : boomError.data;
    ctx.body = {
      ...boomError.output.payload,
      validation,
    };
  } else if (boomError.data) {
    ctx.body = {
      ...boomError.output.payload,
      data: boomError.data,
    };
  }
}
