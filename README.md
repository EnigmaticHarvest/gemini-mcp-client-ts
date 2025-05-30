# MCP Chat CLI

A command-line interface to chat with Google's Gemini model, with the ability to connect to and utilize tools from Model Context Protocol (MCP) servers.

## Prerequisites

*   Node.js (version 18 or higher recommended)
*   npm (comes with Node.js)

## Setup

1.  **Clone the repository (if you haven't already):**
    ```bash
    git clone <repository_url>
    cd mcp-chat-cli
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root of the project directory. Add the following lines, replacing the placeholder with your actual Gemini API key:

    ```env
    GEMINI_API_KEY=YOUR_GEMINI_API_KEY
    # Optional: Specify a Gemini model name. Defaults to a standard one if not set.
    # GEMINI_MODEL_NAME=gemini-1.5-flash-latest 
    ```
    You can obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

## Configuration

### MCP Servers

This CLI can connect to MCP servers to make tools available to the Gemini model. You need to configure these servers first.

*   **Add an MCP Server:**
    ```bash
    npm run cli -- servers add <serverName> <serverUrl>
    ```
    *   `<serverName>`: A unique name you choose for this server (e.g., `my-mcp-server`).
    *   `<serverUrl>`: The full URL of the MCP server (e.g., `http://localhost:8080`).

    The first server you add will automatically become the default server used for tool discovery.

*   **List Configured Servers:**
    ```bash
    npm run cli -- servers list
    ```
    This will show all configured servers and indicate which one is the default.

*   **Set a Default Server:**
    If you have multiple servers, you can specify which one should be used by default for tool discovery.
    ```bash
    npm run cli -- servers default <serverName>
    ```

*   **Remove a Server:**
    ```bash
    npm run cli -- servers remove <serverName>
    ```

## Usage

### Chatting with Gemini

Once your environment variables are set up (and MCP servers are configured if you want to use tools), you can start a chat session:

```bash
npm run cli -- chat
```

During the chat:
*   Type your message and press Enter.
*   If MCP servers are configured and tools are discovered, Gemini may use these tools to respond to your queries.
*   Type `exit` or `quit` to end the chat session.

### Managing MCP Servers

Use the `servers` commands as described in the "Configuration" section to manage your MCP server list.

**Command Structure:**
`npm run cli -- <command> [subcommand] [options]`

**Examples:**
```bash
# Add a local MCP server
npm run cli -- servers add local-tools http://localhost:3000

# List all configured MCP servers
npm run cli -- servers list

# Set 'local-tools' as the default server
npm run cli -- servers default local-tools

# Start a chat session
npm run cli -- chat
```

## Development

*   **Build the project (compile TypeScript to JavaScript):**
    ```bash
    npm run build
    ```
    This will output JavaScript files to the `dist` directory.

*   **Run in development mode (watches for changes and restarts):**
    ```bash
    npm run dev -- <command> 
    ```
    For example, to run the chat in dev mode:
    ```bash
    npm run dev -- chat
    ```

---
