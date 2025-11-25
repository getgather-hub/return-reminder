import './instrument.js'; // Must be first import
import * as Sentry from '@sentry/node';
import express from 'express';
import { Logger } from './logger.js';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { Socket } from 'net';
import path from 'path';

import { fileURLToPath } from 'url';
import { settings } from './config.js';
import ViteExpress from 'vite-express';
import { ipBlocker } from './blocker.js';
import { mcpService } from './mcp-service.js';
import session, { SessionData } from 'express-session';
import bodyParser from 'body-parser';
import locationService from './location-service.js';

// Sentry is initialized in instrument.js

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware to parse JSON bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize proxy service

app.use(ipBlocker());

const createProxy = (path: string) =>
  createProxyMiddleware({
    target: `${settings.GETGATHER_URL}${path}`,
    changeOrigin: true,
    on: {
      proxyReq: fixRequestBody,
      error: (
        err: Error,
        req: express.Request,
        res: express.Response | Socket
      ) => {
        Logger.error('Proxy request failed', err as Error, {
          req: req.toString(),
        });
        if ('status' in res) {
          res.status(500).send('Proxy error occurred');
        }
      },
    },
  });

const proxyPaths = ['/dpage'];

proxyPaths.forEach((path) => {
  app.use(path, createProxy(path));
});

app.use('/api', async (req, res, next) => {
  bodyParser.json()(req, res, async (err) => {
    if (err) return next(err);

    if (req.method === 'POST') {
      if (!req.body) {
        req.body = {};
      }
      const clientIp = locationService.getClientIp(req);
      const requestLocationData =
        await locationService.getLocationForProxy(clientIp);
      req.body.location = requestLocationData;
    }

    createProxy('/api')(req, res, next);
  });
});

app.get('/health', (_, res) => {
  res.send({ status: 'OK', timestamp: Math.floor(Date.now() / 1000) });
});

app.get('/internal/sentry/config', (_, res) => {
  res.json({
    dsn: settings.SENTRY_DSN,
    environment: settings.NODE_ENV,
  });
});

app.use(
  session({
    secret: '1234567890',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: settings.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);
app.use((req, res, next) => {
  if (!('createdAt' in req.session)) {
    (req.session as unknown as SessionData & { createdAt: number }).createdAt =
      Date.now();
  }
  next();
});

app.post('/internal/mcp/get-signin-url', async (req, res) => {
  try {
    const { brand_id } = req.body;

    Logger.info('MCP Dpage URL request', {
      brandId: brand_id,
      sessionId: req.sessionID,
    });

    if (!brand_id) {
      res.status(400).json({
        success: false,
        error: 'brand_id is required',
      });
      return;
    }

    const ipAddress = locationService.getClientIp(req);
    mcpService.setClientIpAddress(req.sessionID, ipAddress);
    const structuredContent = await mcpService.getDpageUrl(
      brand_id,
      req.sessionID
    );

    if (!structuredContent) {
      throw new Error('MCP tool returned no data');
    }

    // Check if we got a URL (authentication required) or direct data
    if (structuredContent?.url) {
      // Rewrite URL to use app host instead of GETGATHER_URL
      const protocol = req.protocol;
      const host = req.get('host') || 'localhost:3000';
      const appHost = `${protocol}://${host}`;
      const serverUrl = mcpService.getServerUrl();

      Logger.debug('Rewriting URL', {
        from: structuredContent.url,
        serverUrl,
        to: appHost,
      });

      if (structuredContent.url.includes(serverUrl)) {
        structuredContent.url = structuredContent.url.replace(
          serverUrl,
          appHost
        );
      }
    }

    res.json({
      success: true,
      data: { ...structuredContent, link_id: structuredContent.signin_id },
    });
  } catch (error) {
    Logger.error('MCP retrieve data failed', error as Error, {
      component: 'server',
      operation: 'retrieve-data',
      brandId: req.body.brand_id,
      sessionId: req.sessionID,
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/internal/mcp/signin-check', async (req, res) => {
  try {
    const { brand_id, link_id } = req.body;

    const structuredContent = await mcpService.checkDpageSignin(
      link_id,
      req.sessionID,
      brand_id
    );

    res.json({
      success: true,
      data: structuredContent,
    });
  } catch (error) {
    Logger.error('MCP dpage url failed', error as Error, {
      component: 'server',
      operation: 'get-signin-url',
    });
  }
});

app.post('/internal/mcp/finalize-signin', async (req, res) => {
  try {
    const { signin_id, brand_id } = req.body;

    if (!signin_id) {
      res.status(400).json({
        success: false,
        error: 'signin_id is required',
      });

      return;
    }

    await mcpService.finalizeSignin({
      signinId: signin_id,
      sessionId: req.sessionID,
      brandId: brand_id,
    });

    res.json({
      success: true,
    });
  } catch (error) {
    Logger.error('MCP dpage finalize signin error:', error as Error, {
      component: 'server',
      operation: 'finalize-signin',
      signinId: req.body.signin_id,
      brandId: req.body.brand_id,
      sessionId: req.sessionID,
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Endpoint to receive order logs from the client and print them on the server console
app.post('/log-orders', (req, res) => {
  Logger.info('Received orders from client', {
    brand: req.body.brand,
    orderCount: req.body.orders?.length || 0,
  });
  // Respond with 204 No Content to signal successful receipt without extra payload
  res.sendStatus(204);
});

try {
  Logger.debug('Checking GETGATHER_URL', { url: settings.GETGATHER_URL });
  const response = await fetch(settings.GETGATHER_URL);
  if (response.status === 200) {
    Logger.info('GetGather service is reachable');
  } else {
    Logger.warn(`GetGather service returned status ${response.status}`);
  }
} catch (error) {
  Logger.warn('GetGather service is not reachable', {
    error: error instanceof Error ? error.message : String(error),
  });
}

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    Logger.error('Unhandled server error', err, {
      component: 'server',
      operation: 'fallback-error-handler',
      url: req.url,
      method: req.method,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
);

if (settings.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*name', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
  app.listen(3000, () => {
    console.log('Server running in production mode on port 3000');
  });
} else {
  ViteExpress.listen(app, 3000, () =>
    console.log('Server listening in development mode on port 3000')
  );
}
