import { Centrifuge, Subscription } from 'centrifuge';
import { Agent } from 'https';
import WebSocket from 'ws';

import { getEASLogsWebsocketUrl } from '../api';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { RealtimeLogsMutation_GenerateCentrifugoSubscriptionTokenArgs } from '../graphql/generated';
import { RealtimeLogsMutation } from '../graphql/mutations/RealtimeLogsMutation';
import { httpsProxyAgent } from '../fetch';
import Log from '../log';

export type RealtimeLogsSubscription = {
  close: () => void;
};

export type RealtimeLogsClient = {
  subscribeAsync: (
    args: RealtimeLogsMutation_GenerateCentrifugoSubscriptionTokenArgs,
    onPublication: (data: unknown) => void
  ) => Promise<RealtimeLogsSubscription | null>;
  close: () => void;
};

type WebSocketConstructor = new (address: string, protocols?: string | string[]) => WebSocket;

function createProxiedWebSocketConstructor(agent: Agent): WebSocketConstructor {
  return class ProxiedWebSocket extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, { agent });
    }
  };
}

function createWebSocketConstructor(): WebSocketConstructor {
  return httpsProxyAgent ? createProxiedWebSocketConstructor(httpsProxyAgent) : WebSocket;
}

export function createRealtimeLogsClient(
  graphqlClient: ExpoGraphqlClient
): RealtimeLogsClient | null {
  const getTokenAsync = async (): Promise<string> => {
    const { token } =
      await RealtimeLogsMutation.generateCentrifugoConnectionTokenAsync(graphqlClient);
    return token;
  };

  let client: Centrifuge;
  try {
    client = new Centrifuge(getEASLogsWebsocketUrl(), {
      websocket: createWebSocketConstructor(),
      getToken: getTokenAsync,
    });
    client.on('error', ({ error }) => {
      Log.debug(`Realtime logs connection error: ${error.message}`);
    });
    client.connect();
  } catch (err: any) {
    Log.debug(`Failed to connect to realtime logs: ${err.message}`);
    return null;
  }

  return {
    subscribeAsync: async (args, onPublication) => {
      const getSubscriptionTokenAsync = async (): Promise<string> => {
        const { token } = await RealtimeLogsMutation.generateCentrifugoSubscriptionTokenAsync(
          graphqlClient,
          args
        );
        return token;
      };

      try {
        const { channel, token } =
          await RealtimeLogsMutation.generateCentrifugoSubscriptionTokenAsync(graphqlClient, args);

        const subscription = client.newSubscription(channel, {
          token,
          getToken: getSubscriptionTokenAsync,
        });

        subscription.on('error', ({ error }) => {
          Log.debug(`Realtime logs subscription error on ${channel}: ${error.message}`);
        });
        subscription.on('publication', ({ data }) => {
          onPublication(data);
        });
        subscription.subscribe();

        return {
          close: () => {
            closeSubscription(client, subscription);
          },
        };
      } catch (err: any) {
        Log.debug(`Failed to subscribe to realtime logs: ${err.message}`);
        return null;
      }
    },
    close: () => {
      for (const subscription of Object.values(client.subscriptions())) {
        closeSubscription(client, subscription);
      }
      client.removeAllListeners();
      client.disconnect();
    },
  };
}

function closeSubscription(client: Centrifuge, subscription: Subscription): void {
  try {
    subscription.unsubscribe();
    subscription.removeAllListeners();
    client.removeSubscription(subscription);
  } catch (err: any) {
    Log.debug(`Failed to close realtime logs subscription: ${err.message}`);
  }
}
