#!/usr/bin/env node
// src/index.ts
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline/promises';
import {
    addServer, listServers as getConfiguredServers, removeServer, setDefaultServer,
    // getDefaultServer, getServer as getConfigServer // Keep if other commands need them
} from './configService.js';
import {
    initializeGeminiModelWithDiscoveredTools,
    startChatSession,
    sendMessageToGemini
} from './geminiService.js';
import { discoverAndMapAllMcpTools } from './mcpToolRegistry.js';
import { processUserInput } from './userInputParser.js';
import './envConfig.js'; // Loads .env and checks for GEMINI_API_KEY

const program = new Command();

program
    .name("mcp-gemini-cli")
    .description(chalk.cyan("CLI to chat with Gemini, using dynamically discovered tools from MCP servers."))
    .version("3.0.0");

// --- Server Management Commands (largely same, but clarify their purpose for tool discovery) ---
const serversCommand = program.command("servers").description("Manage MCP server configurations for tool discovery and execution");

serversCommand
    .command("add <name> <url>")
    .description("Add an MCP server from which tools can be discovered")
    .action(addServer);

serversCommand
    .command("list")
    .description("List all configured MCP servers")
    .action(() => {
        const servers = getConfiguredServers(); // Use the renamed import
        if (servers.length === 0) {
            console.log(chalk.yellow("No MCP servers configured. Use 'servers add <name> <url>' to add one."));
            return;
        }
        console.log(chalk.bold("Configured MCP Servers (for tool discovery):"));
        servers.forEach(s => {
            console.log(`- ${chalk.blue(s.name)}: ${s.url} ${s.default ? chalk.green('(default, if applicable)') : ''}`);
        });
    });

serversCommand
    .command("remove <name>")
    .description("Remove an MCP server configuration")
    .action(removeServer);

serversCommand
    .command("set-default <name>")
    .description("Set a default MCP server (usage depends on specific tool mappings if any)")
    .action(setDefaultServer);


// --- Chat Command ---
program
    .command("chat")
    .description("Start an interactive chat session with Gemini, enabling dynamically discovered tools from configured MCP servers.")
    .action(async () => {
        if (!process.env.GEMINI_API_KEY) {
            console.error(chalk.red("GEMINI_API_KEY is not set. Please ensure it's in your .env file."));
            return;
        }

        // 1. Discover tools from ALL configured MCP servers
        const configuredMcpServers = getConfiguredServers();
        if (configuredMcpServers.length === 0) {
            console.log(chalk.yellow("No MCP servers configured. Gemini tool calling will be disabled."));
            console.log(chalk.yellow("Use 'servers add <name> <url>' to add MCP servers."));
        }
        await discoverAndMapAllMcpTools(configuredMcpServers);

        // 2. Initialize Gemini model with these dynamically discovered tools
        await initializeGeminiModelWithDiscoveredTools();

        // 3. Start chat
        console.log(chalk.green("\nStarting chat session with Gemini..."));
        console.log(chalk.dim("Type 'exit' or 'quit' to end."));

        const chatSession = await startChatSession();
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        try {
            while (true) {
                const userInput = await rl.question(chalk.blueBright("You: "));
                if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
                    break;
                }
                if (!userInput.trim()) continue;

                console.log(chalk.yellow(`\nUser: ${userInput}`));

                const processedMessage = await processUserInput(userInput);
                await sendMessageToGemini(chatSession, processedMessage);
            }
        } catch (error: any) {
            console.error(chalk.red(`Chat session error: ${error.message}`));
            if(error.stack) console.error(chalk.dim(error.stack));
        } finally {
            rl.close();
            console.log(chalk.blue("Chat session ended."));
        }
    });

program.parseAsync(process.argv).catch(err => {
    console.error(chalk.redBright("Unhandled error in CLI:"), err);
    process.exit(1);
});

if (!process.argv.slice(2).length) {
    program.outputHelp();
}
