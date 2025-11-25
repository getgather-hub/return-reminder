import {
  CallToolResultSchema,
  CompatibilityCallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { settings } from './config.js';
import locationService, { LocationData } from './location-service.js';
import { Logger } from './logger.js';

type MCPTool = {
  name: string;
};

const BRAND_MCP_TOOLS: Record<string, MCPTool[]> = {
  amazon: [{ name: 'amazon_dpage_get_purchase_history' }],
  amazonca: [{ name: 'amazonca_dpage_get_purchase_history' }],
  wayfair: [{ name: 'wayfair_dpage_get_order_history' }],
};

export class MCPService {
  private static instance: MCPService | null = null;
  private client: Record<string, Client | null> = {};
  private initPromise: Promise<Client> | null = null;
  private serverUrl: string;
  private clientIpAddresses: Map<string, string> = new Map();

  private constructor() {
    this.serverUrl = settings.GETGATHER_URL || 'http://localhost:8000';
    this.clientIpAddresses = new Map();
  }

  static getInstance(): MCPService {
    if (!MCPService.instance) {
      MCPService.instance = new MCPService();
    }
    return MCPService.instance;
  }

  private async initializeClient(
    sessionId: string,
    brandId: string
  ): Promise<Client> {
    const mcpClientKey = `${sessionId}-${brandId}`;
    if (this.client[mcpClientKey]) return this.client[mcpClientKey];
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const client = new Client(
        { name: 'return-reminder-server', version: '1.0.0' },
        { capabilities: {} }
      );

      const ipAddress = this.clientIpAddresses.get(sessionId);
      let location: LocationData | null = null;
      if (ipAddress) {
        location = await locationService.getLocationForProxy(ipAddress);
      }

      console.log('Setup MCP client with location: ', location);

      const transport = new StreamableHTTPClientTransport(
        new URL(`${this.serverUrl}/mcp/`),
        {
          requestInit: {
            headers: {
              'x-getgather-custom-app': 'return-reminder',
              'x-location': location ? JSON.stringify(location) : '',
              'x-incognito': '1',
            },
          },
        }
      );
      await client.connect(transport);

      this.client[mcpClientKey] = client;
      Logger.info('MCP client initialized successfully');
      return client;
    })();

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async resetAndInitializeClient(
    sessionId: string,
    brandId: string
  ): Promise<Client> {
    const mcpClientKey = `${sessionId}-${brandId}`;
    try {
      if (this.client[mcpClientKey]) {
        await this.client[mcpClientKey].close().catch(() => {});
      }
    } finally {
      this.client[mcpClientKey] = null;
    }

    return this.initializeClient(sessionId, brandId);
  }

  private async callToolWithReconnect(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
      sessionId: string;
      brandId: string;
    },
    resultSchema?:
      | typeof CallToolResultSchema
      | typeof CompatibilityCallToolResultSchema,
    options?: RequestOptions
  ) {
    const { sessionId, brandId } = params;
    try {
      const client = await this.getClient(sessionId, brandId);
      return await client.callTool(params, resultSchema, options);
    } catch (err) {
      Logger.warn('MCP call tool failed, reconnecting', {
        component: 'mcp-service',
        operation: 'callTool',
        toolName: params.name,
        sessionId: params.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.resetAndInitializeClient(params.sessionId, params.brandId);
      const client = await this.getClient(params.sessionId, params.brandId);
      return await client.callTool(params, resultSchema, options);
    }
  }

  async getClient(sessionId: string, brandId: string): Promise<Client> {
    const mcpClientKey = `${sessionId}-${brandId}`;
    if (!this.client[mcpClientKey]) {
      await this.initializeClient(sessionId, brandId);
    }
    if (!this.client[mcpClientKey]) {
      throw new Error('MCP client initialization failed');
    }
    return this.client[mcpClientKey];
  }

  getMCPTools(brandId: string): MCPTool[] {
    const tools = BRAND_MCP_TOOLS[brandId];
    if (!tools) {
      throw new Error(`No MCP tool configured for brand: ${brandId}`);
    }
    return tools;
  }

  async getDpageUrl(brandId: string, sessionId: string) {
    const tools = this.getMCPTools(brandId);
    const result = await this.callToolWithReconnect({
      name: tools[0].name,
      sessionId: sessionId,
      brandId: brandId,
    });

    return result.structuredContent as Record<string, string>;
  }

  async checkDpageSignin(signinId: string, sessionId: string, brandId: string) {
    const result = await this.callToolWithReconnect(
      {
        name: 'check_signin',
        arguments: { signin_id: signinId },
        sessionId,
        brandId,
      },
      undefined,
      {
        timeout: 6000000,
        maxTotalTimeout: 6000000,
      }
    );

    const response = result.structuredContent as {
      status?: string;
      result?: unknown;
    };

    const isAuthCompleted = response?.status === 'SUCCESS';

    let purchases = null;

    if (typeof response.result === 'string') {
      purchases = JSON.parse(response.result);
    } else {
      purchases = response.result || [];
    }

    return {
      status: isAuthCompleted ? 'FINISHED' : 'PENDING',
      purchases,
    } as Record<string, unknown>;
  }

  async finalizeSignin({
    signinId,
    sessionId,
    brandId,
  }: {
    signinId: string;
    sessionId: string;
    brandId: string;
  }) {
    const result = await this.callToolWithReconnect(
      {
        name: 'finalize_signin',
        arguments: { signin_id: signinId },
        sessionId: sessionId,
        brandId: brandId,
      },
      undefined,
      {
        timeout: 6000000,
        maxTotalTimeout: 6000000,
      }
    );

    return result;
  }

  setClientIpAddress(sessionId: string, ipAddress: string) {
    this.clientIpAddresses.set(sessionId, ipAddress);
  }

  getServerUrl(): string {
    return this.serverUrl;
  }
}

export const mcpService = MCPService.getInstance();
