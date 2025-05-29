// src/mcpClientService.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import chalk from 'chalk';

// Infer response types
// Note: This is a common pattern but might need adjustment if the methods are complex (e.g. overloaded)
// For client.callTool
type CallToolParameters = Parameters<Client["callTool"]>[0]; // Get parameters of callTool
// Assuming callTool returns a Promise, get the promised type
type CallToolFnReturnType = ReturnType<Client["callTool"]>; 
export type CallToolResponse = CallToolFnReturnType extends Promise<infer R> ? R : CallToolFnReturnType;

// For client.listTools
// Assuming listTools takes no arguments or we don't need them for ReturnType
type ListToolsFnReturnType = ReturnType<Client["listTools"]>;
export type ListToolsResponse = ListToolsFnReturnType extends Promise<infer R> ? R : ListToolsFnReturnType;

export type McpToolSchema = z.infer<typeof ToolSchema>;

export class GenericMcpClient {
    private client: Client;
    private transport: StreamableHTTPClientTransport;
    private serverUrl: URL;
    private connected: boolean = false;

    constructor(serverUrlString: string, clientName: string = "mcp-gemini-cli-agent", clientVersion: string = "1.0.0") {
        this.serverUrl = new URL(serverUrlString);
        // Note: The MCP SDK's Client constructor takes clientInfo and options.
        // For simplicity here, we're using basic clientInfo.
        this.client = new Client({ name: clientName, version: clientVersion });
        this.transport = new StreamableHTTPClientTransport(this.serverUrl);
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        try {
            await this.client.connect(this.transport);
            this.connected = true;
        } catch (error: any) {
            this.connected = false;
            console.error(chalk.red(`[MCP Client] Connect Error to ${this.serverUrl.href}: ${error.message}`));
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;
        try {
            // The SDK client's close method handles transport closure as well if transport was passed to connect.
            await this.client.close();
        } catch (error: any) {
            console.error(chalk.red(`[MCP Client] Disconnect Error from ${this.serverUrl.href}: ${error.message}`));
        } finally {
            this.connected = false;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async callMcpTool(mcpToolName: string, mcpArguments: any): Promise<CallToolResponse> {
        if (!this.connected) {
            throw new Error("Not connected to MCP server. Cannot call tool.");
        }
        console.log(chalk.blue(`  [MCP Client] Calling MCP tool "${mcpToolName}" on ${this.serverUrl.href}`));
        try {
            // The MCP SDK client.request is generic, listTools and callTool are convenience wrappers.
            // Using the convenience wrapper:
            return await this.client.callTool({
                name: mcpToolName,
                arguments: mcpArguments,
            });
        } catch (error: any) {
            console.error(chalk.red(`  [MCP Client] Error calling MCP tool "${mcpToolName}": ${error.message}`));
            return {
                toolCallId: "error-" + Date.now(),
                isError: true,
                content: [{ type: "text", text: `Error calling MCP tool ${mcpToolName}: ${error.message}` }],
            };
        }
    }

    /**
     * Lists available tools from the connected MCP server.
     * @returns A promise that resolves to an array of McpToolSchema or null if an error occurs.
     */
    async listMcpTools(): Promise<McpToolSchema[] | null> {
        if (!this.connected) {
            console.error(chalk.red(`  [MCP Client] Not connected to ${this.serverUrl.href}. Cannot list tools.`));
            return null;
        }
        try {
            console.log(chalk.dim(`  [MCP Client] Listing tools from ${this.serverUrl.href}...`));
            const response: ListToolsResponse = await this.client.listTools();
            return response.tools || [];
        } catch (error: any) {
            console.error(chalk.red(`  [MCP Client] Error listing tools from ${this.serverUrl.href}: ${error.message}`));
            return null;
        }
    }
}
