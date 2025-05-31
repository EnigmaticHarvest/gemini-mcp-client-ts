// src/geminiService.ts
import {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
    Part,
    ChatSession, // For conversational chat
    GenerativeModel, // For direct model access
    Tool,
} from "@google/generative-ai";
import { GEMINI_API_KEY, GEMINI_MODEL_NAME } from './envConfig.js';
import {
    getDynamicallyGeneratedGeminiFunctionDeclarations,
    findDynamicallyMappedTool,
    DynamicGeminiToolMapping
} from './mcpToolRegistry.js';
import { GenericMcpClient } from './mcpClientService.js';
import { processUserInput } from './userInputParser.js'; // Import the new function
import chalk from 'chalk';

if (!GEMINI_API_KEY) {
    console.error(chalk.red("FATAL ERROR: GEMINI_API_KEY is not defined. Please set it in your .env file."));
    process.exit(1);
}

if (!GEMINI_MODEL_NAME) {
    console.error(chalk.red("FATAL ERROR: GEMINI_MODEL_NAME is not defined. Please set it in your .env file."));
    process.exit(1);
}

const validatedModelName = GEMINI_MODEL_NAME; // GEMINI_MODEL_NAME is now guaranteed to be a string

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Model will be initialized AFTER tool discovery
let geminiModelWithTools: GenerativeModel;

const generationConfig = { // You might want to adjust these
    temperature: 0.7,
    // topK: 1,
    // topP: 1,
    // maxOutputTokens: 2048, // Often set by default, adjust if needed
};
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export async function initializeGeminiModelWithDiscoveredTools(): Promise<void> {
    const dynamicDeclarations = getDynamicallyGeneratedGeminiFunctionDeclarations();
    const toolsForGemini: Tool[] = dynamicDeclarations.length > 0
        ? [{ functionDeclarations: dynamicDeclarations }]
        : [];

    if (toolsForGemini.length > 0) {
        console.log(chalk.blue("Initializing Gemini model with dynamically discovered tools..."));
    } else {
        console.log(chalk.yellow("No tools discovered or mapped. Gemini will operate without tool calling capabilities."));
    }

    geminiModelWithTools = genAI.getGenerativeModel({
        model: validatedModelName, // Use the validated variable
        tools: toolsForGemini,
        safetySettings, // Apply safety settings at model level
        // generationConfig can be passed to startChat or generateContent
    });

    if (toolsForGemini.length > 0) {
      console.log(chalk.green(`${dynamicDeclarations.length} tools configured for Gemini.`));
    }
}

export async function startChatSession(): Promise<ChatSession> {
    if (!geminiModelWithTools) {
        console.error(chalk.red("Gemini model not initialized with tools. Call initializeGeminiModelWithDiscoveredTools() first."));
        // Provide a model without tools as a fallback, or throw error
        const fallbackModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", safetySettings });
        return fallbackModel.startChat({ history: [], generationConfig });
    }
    return geminiModelWithTools.startChat({
        history: [], // Start with empty history
        generationConfig,
    });
}

export async function sendMessageToGemini(
    chatSession: ChatSession,
    userInput: string
): Promise<string> {
    console.log(chalk.yellow(`\nUser: ${userInput}`));

    let currentMessageForGemini: string | Part[] = await processUserInput(userInput);

    let attempt = 0;
    const maxAttempts = 5; // Max attempts for tool calling loop

    while (attempt < maxAttempts) {
        attempt++;
        console.log(chalk.dim(`  (Gemini Call - Attempt ${attempt})`));

        const result = await chatSession.sendMessage(currentMessageForGemini);
        const response = result.response;

        if (!response) {
            console.error(chalk.red("Gemini returned no response content."));
            return "I'm sorry, I couldn't get a response.";
        }

        const functionCalls = response.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
            console.log(chalk.magenta("  Gemini wants to call functions:"));
            const toolResponses: Part[] = [];

            for (const call of functionCalls) {
                console.log(chalk.magenta(`    - Function: ${call.name}`));
                // console.log(chalk.dim(`      Arguments: ${JSON.stringify(call.args)}`));

                const mappedTool: DynamicGeminiToolMapping | undefined = findDynamicallyMappedTool(call.name);
                if (!mappedTool) {
                    console.error(chalk.red(`    Error: Dynamically mapped tool for Gemini function "${call.name}" not found.`));
                    toolResponses.push({
                        functionResponse: {
                            name: call.name,
                            response: { error: `Function ${call.name} is not implemented or mapped.` },
                        },
                    });
                    continue;
                }

                const mcpClient = new GenericMcpClient(mappedTool.mcpServerUrl);
                try {
                    await mcpClient.connect();
                    // Arguments from Gemini (call.args) are directly passed.
                    // This relies on the schema translation being accurate.
                    const mcpArgs = call.args;
                    const mcpToolResult = await mcpClient.callMcpTool(mappedTool.mcpToolName, mcpArgs);

                    toolResponses.push({
                        functionResponse: {
                            name: call.name,
                            response: mcpToolResult, // Send the entire MCP CallToolResponse object
                        },
                    });
                    console.log(chalk.green(`    MCP Tool "${mappedTool.mcpToolName}" on server "${mappedTool.mcpServerName}" executed.`));
                } catch (e: any) {
                    console.error(chalk.red(`    Error during MCP tool execution for ${call.name}: ${e.message}`));
                    toolResponses.push({
                        functionResponse: {
                            name: call.name,
                            response: { error: `Error executing MCP tool ${mappedTool.mcpToolName}: ${e.message}` },
                        },
                    });
                } finally {
                    if (mcpClient.isConnected()) {
                        await mcpClient.disconnect();
                    }
                }
            }
            currentMessageForGemini = toolResponses; // Next message to Gemini is the list of tool results
            // Continue the loop to send tool results back to Gemini
        } else {
            // No function call, just a text response
            const text = response.text();
            if (text === undefined || text === null) {
                 console.log(chalk.yellow("AI: Received a response, but it has no text content."));
                 return "I received a response, but it was empty.";
            }
            console.log(chalk.cyanBright(`\nAI: ${text}`));
            return text;
        }
    }
    console.error(chalk.red("Exceeded maximum tool call attempts."));
    return "I tried several times, but I'm having trouble completing your request with tools.";
}
