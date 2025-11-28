import RudderStackClient from '@expo/rudder-sdk-node';

let client: RudderStackClient | null = null;

interface APIObject {
  [index: string]:
    | string
    | number
    | boolean
    | undefined
    | APIObject
    | (string | number | boolean | APIObject)[];
}

export class Analytics<Event extends string> {
  constructor(
    public readonly userId: string,
    public readonly properties: APIObject
  ) {}

  public logEvent(event: Event, properties: APIObject): void {
    if (!client) {
      return;
    }

    client.track({
      event,
      properties: {
        ...this.properties,
        ...properties,
      },
      userId: this.userId,
    });
  }

  public async flushEventsAsync(): Promise<void> {
    if (!client) {
      return;
    }

    await client.flush();
  }
}

export function initialize(writeKey: string | null, dataPlaneURL: string | null): void {
  if (!(writeKey && dataPlaneURL)) {
    return;
  }

  client = new RudderStackClient(writeKey, dataPlaneURL);
}
