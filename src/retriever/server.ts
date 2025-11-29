/**
 * HTTP Server for Experience Retrieval
 *
 * Provides a simple HTTP API for searching and recording principle usage.
 * Designed for potential MCP (Model Context Protocol) tool integration.
 */

import { serve } from 'bun';
import { ExperienceRetriever } from './retriever';
import { SearchQuery, PrincipleUsageUpdate } from '../types';
import { resolve } from 'path';

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Port to listen on */
  port?: number;

  /** Host to bind to */
  host?: string;

  /** Path to the experience base database */
  dbPath?: string;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Enable CORS */
  cors?: boolean;
}

/**
 * HTTP server for experience retrieval operations
 */
export class RetrievalServer {
  private retriever: ExperienceRetriever;
  private config: ServerConfig;

  constructor(config: ServerConfig = {}) {
    this.config = {
      port: 3000,
      host: 'localhost',
      dbPath: resolve(process.cwd(), 'expbase.db'),
      verbose: false,
      cors: true,
      ...config,
    };

    this.retriever = new ExperienceRetriever({
      dbPath: this.config.dbPath!,
      verbose: this.config.verbose,
    });
  }

  /**
   * Start the HTTP server
   */
  start(): void {
    const server = serve({
      port: this.config.port,
      hostname: this.config.host,
      fetch: async (req) => this.handleRequest(req),
    });

    console.log(
      `Experience Retrieval Server running at http://${this.config.host}:${this.config.port}`
    );
    console.log(`Database: ${this.config.dbPath}`);
    console.log('\nEndpoints:');
    console.log('  POST /search         - Search for principles');
    console.log('  POST /record         - Record principle usage outcome');
    console.log('  GET  /stats          - Get experience base statistics');
    console.log('  GET  /principle/:id  - Get principle details');
    console.log('  GET  /health         - Health check');
    console.log();
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS headers
    const corsHeaders = this.config.cors
      ? {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      : {};

    // Handle OPTIONS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // Route requests
      if (path === '/search' && method === 'POST') {
        return await this.handleSearch(req, corsHeaders);
      }

      if (path === '/record' && method === 'POST') {
        return await this.handleRecord(req, corsHeaders);
      }

      if (path === '/stats' && method === 'GET') {
        return await this.handleStats(corsHeaders);
      }

      if (path.startsWith('/principle/') && method === 'GET') {
        const id = path.split('/')[2];
        return await this.handleGetPrinciple(id, corsHeaders);
      }

      if (path === '/health' && method === 'GET') {
        return this.handleHealth(corsHeaders);
      }

      // 404 Not Found
      return new Response(
        JSON.stringify({ error: 'Not found', path, method }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    } catch (error) {
      return this.handleError(error, corsHeaders);
    }
  }

  /**
   * Handle POST /search
   */
  private async handleSearch(
    req: Request,
    corsHeaders: Record<string, string>
  ): Promise<Response> {
    try {
      const query: SearchQuery = await req.json();

      if (this.config.verbose) {
        console.log('Search query:', JSON.stringify(query, null, 2));
      }

      const response = await this.retriever.searchExperience(query);

      return new Response(JSON.stringify(response, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      return this.handleError(error, corsHeaders);
    }
  }

  /**
   * Handle POST /record
   */
  private async handleRecord(
    req: Request,
    corsHeaders: Record<string, string>
  ): Promise<Response> {
    try {
      const body: PrincipleUsageUpdate = await req.json();

      if (!body.principle_id) {
        return new Response(
          JSON.stringify({ error: 'principle_id is required' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      if (body.was_successful === undefined) {
        return new Response(
          JSON.stringify({ error: 'was_successful is required' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      await this.retriever.recordUsage(
        body.principle_id,
        body.was_successful,
        body.trace_id
      );

      if (this.config.verbose) {
        console.log(
          `Recorded ${body.was_successful ? 'successful' : 'unsuccessful'} use of principle ${body.principle_id}`
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Usage recorded',
          principle_id: body.principle_id,
          was_successful: body.was_successful,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    } catch (error) {
      return this.handleError(error, corsHeaders);
    }
  }

  /**
   * Handle GET /stats
   */
  private async handleStats(corsHeaders: Record<string, string>): Promise<Response> {
    try {
      const stats = this.retriever.getStorage().getStats();

      return new Response(JSON.stringify(stats, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      return this.handleError(error, corsHeaders);
    }
  }

  /**
   * Handle GET /principle/:id
   */
  private async handleGetPrinciple(
    id: string,
    corsHeaders: Record<string, string>
  ): Promise<Response> {
    try {
      const principle = this.retriever.getPrinciple(id);

      if (!principle) {
        return new Response(
          JSON.stringify({ error: 'Principle not found', id }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      return new Response(JSON.stringify(principle, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      return this.handleError(error, corsHeaders);
    }
  }

  /**
   * Handle GET /health
   */
  private handleHealth(corsHeaders: Record<string, string>): Response {
    const stats = this.retriever.getStorage().getStats();

    return new Response(
      JSON.stringify({
        status: 'healthy',
        database: this.config.dbPath,
        principles: stats.principle_count,
        traces: stats.trace_count,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  /**
   * Handle errors
   */
  private handleError(
    error: unknown,
    corsHeaders: Record<string, string>
  ): Response {
    const message = error instanceof Error ? error.message : String(error);

    if (this.config.verbose) {
      console.error('Server error:', message);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }

    return new Response(
      JSON.stringify({ error: 'Internal server error', message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  /**
   * Close the server and cleanup resources
   */
  close(): void {
    this.retriever.close();
  }
}

/**
 * Start server from command line
 */
if (import.meta.main) {
  const args = process.argv.slice(2);
  const config: ServerConfig = {};

  // Parse command-line arguments
  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      config.port = Number.parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--host=')) {
      config.host = arg.split('=')[1];
    } else if (arg.startsWith('--db=')) {
      config.dbPath = arg.split('=')[1];
    } else if (arg === '--verbose') {
      config.verbose = true;
    } else if (arg === '--no-cors') {
      config.cors = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: bun src/retriever/server.ts [options]

Options:
  --port=N        Port to listen on (default: 3000)
  --host=HOST     Host to bind to (default: localhost)
  --db=PATH       Path to database (default: ./expbase.db)
  --verbose       Enable verbose logging
  --no-cors       Disable CORS headers
  --help, -h      Show this help message

Examples:
  bun src/retriever/server.ts
  bun src/retriever/server.ts --port=8080 --verbose
  bun src/retriever/server.ts --db=/path/to/expbase.db --host=0.0.0.0
`);
      process.exit(0);
    }
  }

  const server = new RetrievalServer(config);
  server.start();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down server...');
    server.close();
    process.exit(0);
  });
}

export default RetrievalServer;

