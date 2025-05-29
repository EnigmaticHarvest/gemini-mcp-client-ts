// src/mcpToolRegistry.ts
import { FunctionDeclaration, FunctionDeclarationSchema, Schema, SchemaType, StringSchema, ArraySchema, ObjectSchema } from "@google/generative-ai";
import { ToolSchema as McpToolSchemaZod } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { GenericMcpClient } from './mcpClientService.js';
import { McpServerConfig } from './configService.js';
import chalk from 'chalk';

export type McpToolSchema = z.infer<typeof McpToolSchemaZod>;

// McpJsonSchema is the type of the inputSchema within an McpToolSchema
// It can be a boolean (true/false schema) or an object with properties.
export type McpJsonSchema = NonNullable<McpToolSchema["inputSchema"]>;

// McpJsomSchemaType is the 'type' property within an McpJsonSchema (if it's an object schema)
// It can be a single string (e.g., "string", "object") or an array of such strings.
export type McpJsomSchemaType = McpJsonSchema extends { type: infer T; } ? T :
    McpJsonSchema extends boolean ? "boolean" :  // Represent boolean schema type as "boolean"
    any; // Fallback for other cases (e.g. if inputSchema is not an object with a type)

export interface DynamicGeminiToolMapping {
    geminiFunctionDeclaration: FunctionDeclaration;
    mcpServerName: string;
    mcpServerUrl: string;
    mcpToolName: string;
}

let currentSessionTools: DynamicGeminiToolMapping[] = [];

function mcpSchemaTypeToGeminiSchemaType(mcpType: McpJsomSchemaType | McpJsomSchemaType[] | undefined): SchemaType | undefined {
    if (Array.isArray(mcpType)) {
        const nonNullType = mcpType.find(t => t !== null && t !== undefined);
        return nonNullType ? mcpSchemaTypeToGeminiSchemaType(nonNullType) : undefined;
    }
    // Cast mcpType to string here to satisfy linter for specific literal type comparisons
    switch (mcpType as string) {
        case "string": return SchemaType.STRING;
        case "number": return SchemaType.NUMBER;
        case "integer": return SchemaType.INTEGER;
        case "boolean": return SchemaType.BOOLEAN;
        case "array": return SchemaType.ARRAY;
        case "object": return SchemaType.OBJECT;
        case "null": return undefined;
        default:
            console.warn(chalk.yellow(`  [Schema Xlate] Unsupported MCP schema type: ${mcpType}. Treating as STRING if possible, else undefined.`));
            return undefined;
    }
}

function translateMcpPropertiesToGeminiProperties(
    mcpProperties: Record<string, McpJsonSchema> | undefined
): Record<string, Schema> | undefined {
    if (!mcpProperties) return undefined;

    const geminiProperties: Record<string, Schema> = {};
    for (const key in mcpProperties) {
        const mcpPropSchema = mcpProperties[key];
        if (typeof mcpPropSchema === 'boolean') {
            console.warn(chalk.yellow(`  [Schema Xlate] Boolean schema for property "${key}" is not directly translatable to Gemini. Skipping.`));
            continue;
        }

        const geminiType = mcpSchemaTypeToGeminiSchemaType(mcpPropSchema.type);
        if (!geminiType) {
            console.warn(chalk.yellow(`  [Schema Xlate] Could not map MCP type "${mcpPropSchema.type}" for property "${key}" to Gemini type. Skipping property.`));
            continue;
        }

        const geminiProp: Schema = {
            type: geminiType,
            description: mcpPropSchema.description || `Parameter ${key}`,
        } as Schema; // Use type assertion for base properties

        if (mcpPropSchema.enum && Array.isArray(mcpPropSchema.enum) && geminiType === SchemaType.STRING) { // Check if enum is an array
            (geminiProp as StringSchema).enum = mcpPropSchema.enum.map(String);
        }

        if (geminiType === SchemaType.ARRAY && mcpPropSchema.items) {
            if (typeof mcpPropSchema.items === 'object' && !Array.isArray(mcpPropSchema.items)) {
                const itemSchema = translateMcpSchemaToGeminiSchema(mcpPropSchema.items as McpJsonSchema);
                if (itemSchema) (geminiProp as ArraySchema).items = itemSchema;
            } else {
                console.warn(chalk.yellow(`  [Schema Xlate] Array property "${key}" has complex/unsupported 'items' schema. Items will be generic.`));
            }
        } else if (geminiType === SchemaType.OBJECT && mcpPropSchema.properties) {
            const nestedProperties = translateMcpPropertiesToGeminiProperties(mcpPropSchema.properties as Record<string, McpJsonSchema>);
            if (nestedProperties) (geminiProp as ObjectSchema).properties = nestedProperties;
            if (mcpPropSchema.required) (geminiProp as ObjectSchema).required = mcpPropSchema.required;
        }
        geminiProperties[key] = geminiProp;
    }
    return geminiProperties;
}

function translateMcpSchemaToGeminiSchema(mcpSchema: McpJsonSchema): ObjectSchema | undefined {
    if (typeof mcpSchema === 'boolean') {
        console.warn(chalk.yellow(`  [Schema Xlate] Boolean schema is not directly translatable to Gemini parameter schema. Skipping.`));
        return undefined;
    }
    // Ensure mcpSchema and its type property are defined before accessing type
    if (!mcpSchema || typeof mcpSchema !== 'object' || !mcpSchema.type || mcpSchema.type !== "object") {
        console.warn(chalk.yellow("  [Schema Xlate] MCP tool inputSchema is not type 'object' or missing. Gemini tools require object parameters. Creating empty object schema."));
        return { type: SchemaType.OBJECT, properties: {}, required: [] };
    }

    const geminiProperties = translateMcpPropertiesToGeminiProperties(mcpSchema.properties as Record<string, McpJsonSchema>);

    return {
        type: SchemaType.OBJECT,
        properties: geminiProperties || {},
        required: mcpSchema.required || [],
    };
}

function mcpToolToGeminiFunction(mcpTool: McpToolSchema, mcpServerName: string): FunctionDeclaration | null {
    // Check if inputSchema exists and is an object before proceeding
    if (!mcpTool.inputSchema || typeof mcpTool.inputSchema !== 'object') {
        console.warn(chalk.yellow(`  [Tool Xlate] Tool "${mcpTool.name}" from server "${mcpServerName}" has no inputSchema or it's not an object. Skipping.`));
        return null;
    }
    // Further check if inputSchema.type is 'object'
    const inputSchemaAsMcpJson = mcpTool.inputSchema as McpJsonSchema; 
    // Check if it's a boolean schema first
    if (typeof inputSchemaAsMcpJson === 'boolean') {
        console.warn(chalk.yellow(`  [Tool Xlate] Tool "${mcpTool.name}" from server "${mcpServerName}" has a boolean inputSchema. Skipping.`));
        return null;
    }
    // Now, it should be an object, check its type property
    if (inputSchemaAsMcpJson.type !== "object") {
         console.warn(chalk.yellow(`  [Tool Xlate] Tool "${mcpTool.name}" from server "${mcpServerName}" has inputSchema type "${inputSchemaAsMcpJson.type}" instead of "object". Skipping.`));
        return null;
    }

    const sanitizedServerName = mcpServerName.replace(/[^a-zA-Z0-9_]/g, '_');
    const sanitizedMcpToolName = mcpTool.name.replace(/[^a-zA-Z0-9_]/g, '_');
    let geminiFunctionName = `${sanitizedServerName}_${sanitizedMcpToolName}`;
    if (geminiFunctionName.length > 63) {
        geminiFunctionName = geminiFunctionName.substring(0, 63);
    }

    const geminiParameters = translateMcpSchemaToGeminiSchema(inputSchemaAsMcpJson);
    if (!geminiParameters) {
        console.warn(chalk.yellow(`  [Tool Xlate] Could not translate inputSchema for tool "${mcpTool.name}" from server "${mcpServerName}". Skipping.`));
        return null;
    }

    return {
        name: geminiFunctionName,
        description: mcpTool.description || `Calls ${mcpTool.name} on MCP server ${mcpServerName}. ${(mcpTool.annotations as any)?.title || ''}`,
        parameters: geminiParameters, // geminiParameters is ObjectSchema | undefined
    };
}

export async function discoverAndMapAllMcpTools(configuredServers: McpServerConfig[]): Promise<void> {
    console.log(chalk.cyanBright("\nDiscovering tools from configured MCP servers..."));
    currentSessionTools = [];

    for (const serverConfig of configuredServers) {
        console.log(chalk.blue(`Checking server: ${serverConfig.name} (${serverConfig.url})`));
        const mcpClient = new GenericMcpClient(serverConfig.url);
        try {
            await mcpClient.connect();
            if (mcpClient.isConnected()) {
                const mcpTools = await mcpClient.listMcpTools(); // This now comes from GenericMcpClient
                if (mcpTools && mcpTools.length > 0) {
                    console.log(chalk.green(`  Found ${mcpTools.length} tools on ${serverConfig.name}:`));
                    for (const mcpTool of mcpTools) {
                        console.log(chalk.dim(`    - Mapping MCP tool: ${mcpTool.name}`));
                        const geminiFuncDecl = mcpToolToGeminiFunction(mcpTool, serverConfig.name);
                        if (geminiFuncDecl) {
                            currentSessionTools.push({
                                geminiFunctionDeclaration: geminiFuncDecl,
                                mcpServerName: serverConfig.name,
                                mcpServerUrl: serverConfig.url,
                                mcpToolName: mcpTool.name,
                            });
                            console.log(chalk.dim(`      -> Mapped to Gemini tool: ${geminiFuncDecl.name}`));
                        } else {
                             console.log(chalk.yellow(`      -> Failed to map MCP tool ${mcpTool.name} to Gemini tool.`));
                        }
                    }
                } else {
                    console.log(chalk.yellow(`  No tools found or an error occurred on ${serverConfig.name}.`));
                }
            }
        } catch (error: any) {
            // Error already logged by mcpClient
        } finally {
            if (mcpClient.isConnected()) {
                await mcpClient.disconnect();
            }
        }
    }
    console.log(chalk.cyanBright(`Tool discovery complete. ${currentSessionTools.length} MCP tools mapped for Gemini.\n`));
}

export function getDynamicallyGeneratedGeminiFunctionDeclarations(): FunctionDeclaration[] {
    return currentSessionTools.map(tool => tool.geminiFunctionDeclaration);
}

export function findDynamicallyMappedTool(geminiFunctionName: string): DynamicGeminiToolMapping | undefined {
    return currentSessionTools.find(tool => tool.geminiFunctionDeclaration.name === geminiFunctionName);
}
