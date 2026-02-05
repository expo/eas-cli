import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import fetch from 'node-fetch';
import { ZodError, z } from 'zod';

type ApiSchema = {
  [Path in string]: {
    path?: z.ZodType<Record<string, string>>;
    request: z.ZodType<unknown>;
    response: z.ZodType<unknown>;
  };
};

const GetApi = {
  '/v1/apps/:id': {
    path: z.object({
      id: z.string(),
    }),
    request: z.object({
      'fields[apps]': z.array(z.enum(['bundleId', 'name'])).refine(opts => {
        // Let's say we currently require fetching these two and nothing else.
        return opts.includes('bundleId') && opts.includes('name');
      }),
    }),
    response: z.object({
      data: z.object({
        type: z.literal('apps'),
        id: z.string(),
        attributes: z.object({
          bundleId: z.string(),
          name: z.string(),
        }),
      }),
    }),
  },
  '/v1/buildUploadFiles/:id': {
    path: z.object({
      id: z.string(),
    }),
    request: z.object({
      'fields[buildUploadFiles]': z.array(z.enum(['assetDeliveryState'])).refine(opts => {
        return opts.includes('assetDeliveryState');
      }),
    }),
    response: z.object({
      data: z.object({
        type: z.literal('buildUploadFiles'),
        id: z.string(),
        attributes: z.object({
          // https://developer.apple.com/documentation/appstoreconnectapi/appmediaassetstate
          assetDeliveryState: z.object({
            state: z.enum(['AWAITING_UPLOAD', 'UPLOAD_COMPLETE', 'COMPLETE', 'FAILED']),
            errors: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
            warnings: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
          }),
        }),
      }),
    }),
  },
  '/v1/buildUploads/:id': {
    path: z.object({
      id: z.string(),
    }),
    request: z.object({
      'fields[buildUploads]': z.array(z.enum(['build', 'state'])).refine(opts => {
        return opts.includes('build') && opts.includes('state');
      }),
      include: z.array(z.enum(['build'])).refine(opts => {
        return opts.includes('build');
      }),
    }),
    // https://developer.apple.com/documentation/appstoreconnectapi/builduploadresponse
    response: z.object({
      data: z.object({
        type: z.literal('buildUploads'),
        id: z.string(),
        attributes: z.object({
          // https://developer.apple.com/documentation/appstoreconnectapi/buildupload/attributes-data.dictionary/state-data.dictionary
          state: z.object({
            state: z.enum(['AWAITING_UPLOAD', 'PROCESSING', 'COMPLETE', 'FAILED']),
            infos: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
            errors: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
            warnings: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
          }),
        }),
      }),
    }),
  },
} satisfies ApiSchema;

const PostApi = {
  '/v1/buildUploads': {
    request: z.object({
      // https://developer.apple.com/documentation/appstoreconnectapi/builduploadcreaterequest/data-data.dictionary
      data: z.object({
        type: z.literal('buildUploads'),
        // https://developer.apple.com/documentation/appstoreconnectapi/builduploadcreaterequest/data-data.dictionary/attributes-data.dictionary
        attributes: z.object({
          cfBundleShortVersionString: z.string(),
          cfBundleVersion: z.string(),
          // https://developer.apple.com/documentation/appstoreconnectapi/platform
          platform: z.enum(['IOS', 'MAC_OS', 'TV_OS', 'VISION_OS']),
        }),
        // https://developer.apple.com/documentation/appstoreconnectapi/builduploadcreaterequest/data-data.dictionary/relationships-data.dictionary
        relationships: z.object({
          // https://developer.apple.com/documentation/appstoreconnectapi/builduploadcreaterequest/data-data.dictionary/relationships-data.dictionary/app-data.dictionary
          app: z.object({
            // https://developer.apple.com/documentation/appstoreconnectapi/builduploadcreaterequest/data-data.dictionary/relationships-data.dictionary/app-data.dictionary/data-data.dictionary
            data: z.object({
              type: z.literal('apps'),
              id: z.string(),
            }),
          }),
        }),
      }),
    }),
    // https://developer.apple.com/documentation/appstoreconnectapi/builduploadresponse
    response: z.object({
      // https://developer.apple.com/documentation/appstoreconnectapi/buildupload
      data: z.object({
        id: z.string(),
        type: z.literal('buildUploads'),
      }),
    }),
  },
  '/v1/buildUploadFiles': {
    // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfilecreaterequest
    request: z.object({
      // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfilecreaterequest/data-data.dictionary
      data: z.object({
        type: z.literal('buildUploadFiles'),
        // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfilecreaterequest/data-data.dictionary/attributes-data.dictionary
        attributes: z.object({
          assetType: z.enum(['ASSET', 'ASSET_DESCRIPTION', 'ASSET_SPI']),
          fileName: z.string(),
          fileSize: z.number().min(1).max(9007199254740991),
          uti: z.enum([
            'com.apple.binary-property-list',
            'com.apple.ipa',
            'com.apple.pkg',
            'com.apple.xml-property-list',
            'com.pkware.zip-archive',
          ]),
        }),
        // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfilecreaterequest/data-data.dictionary/relationships-data.dictionary
        relationships: z.object({
          // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfilecreaterequest/data-data.dictionary/relationships-data.dictionary/buildupload-data.dictionary
          buildUpload: z.object({
            // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfilecreaterequest/data-data.dictionary/relationships-data.dictionary/buildupload-data.dictionary/data-data.dictionary
            data: z.object({
              type: z.literal('buildUploads'),
              id: z.string(),
            }),
          }),
        }),
      }),
    }),
    // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfileresponse
    response: z.object({
      // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfile
      data: z.object({
        type: z.literal('buildUploadFiles'),
        id: z.string(),
        // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfile/attributes-data.dictionary
        attributes: z.object({
          // https://developer.apple.com/documentation/appstoreconnectapi/appmediaassetstate
          uploadOperations: z.array(
            // https://developer.apple.com/documentation/appstoreconnectapi/deliveryfileuploadoperation
            z.object({
              length: z.number().min(1).max(9007199254740991),
              method: z.string(),
              offset: z.number().min(0).max(9007199254740991),
              partNumber: z.number().min(1).max(9007199254740991),
              requestHeaders: z.array(
                z.object({
                  name: z.string(),
                  value: z.string(),
                })
              ),
              url: z.string(),
            })
          ),
        }),
      }),
    }),
  },
} satisfies ApiSchema;

const PatchApi = {
  // https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-builduploadfiles-_id_
  '/v1/buildUploadFiles/:id': {
    path: z.object({
      id: z.string(),
    }),
    request: z.object({
      // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfileupdaterequest/data-data.dictionary
      data: z.object({
        id: z.string(),
        type: z.literal('buildUploadFiles'),
        // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfileupdaterequest/data-data.dictionary/attributes-data.dictionary
        attributes: z.object({
          uploaded: z.boolean(),
        }),
      }),
    }),
    response: z.object({
      // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfile
      data: z.object({
        type: z.literal('buildUploadFiles'),
        id: z.string(),
        // https://developer.apple.com/documentation/appstoreconnectapi/builduploadfile/attributes-data.dictionary
        attributes: z.object({
          // https://developer.apple.com/documentation/appstoreconnectapi/appmediaassetstate
          assetDeliveryState: z.object({
            state: z.enum(['AWAITING_UPLOAD', 'UPLOAD_COMPLETE', 'COMPLETE', 'FAILED']),
            errors: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
            warnings: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
          }),
        }),
      }),
    }),
  },
} satisfies ApiSchema;

export type AscApiClientPostApi = {
  [Path in keyof typeof PostApi]: {
    request: z.input<(typeof PostApi)[Path]['request']>;
    response: z.output<(typeof PostApi)[Path]['response']>;
  };
};

export type AscApiClientPatchApi = {
  [Path in keyof typeof PatchApi]: {
    request: z.input<(typeof PatchApi)[Path]['request']>;
    response: z.output<(typeof PatchApi)[Path]['response']>;
  };
};

export class AscApiClient {
  private readonly baseUrl = 'https://api.appstoreconnect.apple.com';
  private readonly token: string;
  private readonly logger?: bunyan;

  constructor({ token, logger }: { token: string; logger?: bunyan }) {
    this.token = token;
    this.logger = logger;
  }

  public async getAsync<TPath extends keyof typeof GetApi>(
    path: TPath,
    body: z.input<(typeof GetApi)[TPath]['request']>,
    params?: z.input<(typeof GetApi)[TPath]['path']>
  ): Promise<z.output<(typeof GetApi)[TPath]['response']>> {
    const schema = GetApi[path];

    let effectivePath: string = path;
    for (const [key, value] of Object.entries(params ?? {})) {
      effectivePath = effectivePath.replace(`:${key}`, String(value));
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (Array.isArray(value)) {
        searchParams.set(key, value.join(','));
      } else {
        searchParams.set(key, String(value));
      }
    }

    return await this.sendRequestAsync({
      method: 'GET',
      path: `${effectivePath}?${searchParams.toString()}`,
      body,
      requestSchema: schema.request,
      responseSchema: schema.response,
    });
  }

  public async postAsync<TPath extends keyof typeof PostApi>(
    path: TPath,
    body: z.input<(typeof PostApi)[TPath]['request']>
  ): Promise<z.output<(typeof PostApi)[TPath]['response']>> {
    const schema = PostApi[path];
    return await this.sendRequestAsync({
      method: 'POST',
      path,
      body,
      requestSchema: schema.request,
      responseSchema: schema.response,
    });
  }

  public async patchAsync<TPath extends keyof typeof PatchApi>(
    path: TPath,
    body: z.input<(typeof PatchApi)[TPath]['request']>,
    params: z.input<(typeof PatchApi)[TPath]['path']>
  ): Promise<z.output<(typeof PatchApi)[TPath]['response']>> {
    const schema = PatchApi[path];

    let effectivePath: string = path;
    for (const [key, value] of Object.entries(params)) {
      effectivePath = effectivePath.replace(`:${key}`, String(value));
    }

    return await this.sendRequestAsync({
      method: 'PATCH',
      path: effectivePath,
      body,
      requestSchema: schema.request,
      responseSchema: schema.response,
    });
  }

  private async sendRequestAsync({
    path,
    method,
    body,
    requestSchema,
    responseSchema,
  }: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body: unknown;
    requestSchema: z.ZodType<any>;
    responseSchema: z.ZodType<any>;
  }): Promise<any> {
    const url = new URL(path, this.baseUrl).toString();

    const parsedBody = await asyncResult((async () => requestSchema.parse(body))());
    if (!parsedBody.ok) {
      throw new Error(
        `Malformed request to App Store Connect: ${z.prettifyError(
          parsedBody.enforceError() as ZodError
        )}`
      );
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(parsedBody.value),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Unexpected response (${response.status}) from App Store Connect: ${text}`, {
        cause: response,
      });
    }

    const json = await response.json();

    this.logger?.debug(`Response from App Store Connect: ${JSON.stringify(json, null, 2)}`);

    const parsedResponse = await asyncResult((async () => responseSchema.parse(json))());
    if (!parsedResponse.ok) {
      throw new Error(
        `Malformed response from App Store Connect: ${z.prettifyError(
          parsedResponse.enforceError() as ZodError
        )}`
      );
    }
    return parsedResponse.value;
  }
}
