import openBrowserAsync from 'better-opn';
import http from 'http';
import { Socket } from 'node:net';
import querystring from 'querystring';

import Log from '../log';

const successBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Expo SSO Login</title>
  <meta charset="utf-8">
  <style type="text/css">
    html {
      margin: 0;
      padding: 0
    }

    body {
      background-color: #fff;
      font-family: Tahoma,Verdana;
      font-size: 16px;
      color: #000;
      max-width: 100%;
      box-sizing: border-box;
      padding: .5rem;
      margin: 1em;
      overflow-wrap: break-word
    }
  </style>
</head>
<body>
  SSO login complete. You may now close this tab and return to the command prompt.
</body>
</html>`;

export async function getSessionUsingBrowserAuthFlowAsync(options: {
  expoWebsiteUrl: string;
  serverPort: number;
}): Promise<string> {
  const { expoWebsiteUrl, serverPort } = options;
  if (!expoWebsiteUrl || !serverPort) {
    throw new Error('Expo website URL and local server port are required.');
  }
  const scheme = 'http';
  const hostname = 'localhost';
  const path = '/auth/callback';
  const redirectUri = `${scheme}://${hostname}:${serverPort}${path}`;

  const buildExpoSsoLoginUrl = (): string => {
    const data = {
      app_redirect_uri: redirectUri,
    };
    const params = querystring.stringify(data);
    return `${expoWebsiteUrl}/sso-login?${params}`;
  };

  // Start server and begin auth flow
  const executeAuthFlow = (): Promise<string> => {
    return new Promise<string>(async (resolve, reject) => {
      const connections = new Set<Socket>();

      const server = http.createServer(
        (request: http.IncomingMessage, response: http.ServerResponse) => {
          try {
            if (!(request.method === 'GET' && request.url?.includes('/auth/callback'))) {
              throw new Error('Unexpected SSO login response.');
            }
            const url = new URL(request.url, `http:${request.headers.host}`);
            const sessionSecret = url.searchParams.get('session_secret');

            if (!sessionSecret) {
              throw new Error('Request missing session_secret search parameter.');
            }
            resolve(sessionSecret);
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.write(successBody);
            response.end();
          } catch (error) {
            reject(error);
          } finally {
            server.close();
            // Ensure that the server shuts down
            for (const connection of connections) {
              connection.destroy();
            }
          }
        }
      );

      server.listen(serverPort, hostname, () => {
        Log.log('Waiting for browser login...');
      });

      server.on('connection', connection => {
        connections.add(connection);

        connection.on('close', () => {
          connections.delete(connection);
        });
      });

      const authorizeUrl = buildExpoSsoLoginUrl();
      openBrowserAsync(authorizeUrl);
    });
  };

  return await executeAuthFlow();
}
