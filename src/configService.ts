// src/configService.ts
import Conf from 'conf';
import chalk from 'chalk';

export interface McpServerConfig {
    name: string;
    url: string;
    default?: boolean; // To mark a default server
}

// Schema for validation (optional but good)
const schema = {
    servers: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                url: { type: 'string', format: 'url' },
                default: { type: 'boolean' }
            },
            required: ['name', 'url']
        },
        default: []
    },
    defaultServerName: { // Store the name of the default server
        type: ['string', 'null'], // Allow string or null
    }
};

// The type for the entire configuration stored by 'conf'
interface ConfigStore {
    servers: McpServerConfig[];
    defaultServerName: string | null;
}


const config = new Conf<ConfigStore>({
    projectName: 'mcp-chat-cli', // Creates mcp-chat-cli/config.json in user's config dir
    schema: schema as any, // Cast due to Conf's schema typing complexity
    defaults: {
        servers: [],
        defaultServerName: null,
    }
});


export function addServer(name: string, url: string): void {
    const servers = config.get('servers', []);
    if (servers.some(s => s.name === name)) {
        console.log(chalk.yellow(`Server with name "${name}" already exists. Use 'servers update' or choose a different name.`));
        return;
    }
    try {
        new URL(url); // Validate URL format
    } catch (error) {
        console.error(chalk.red(`Invalid URL format: ${url}`));
        return;
    }
    servers.push({ name, url });
    config.set('servers', servers);
    console.log(chalk.green(`Server "${name}" (${url}) added.`));
    if (servers.length === 1) {
        setDefaultServer(name); // Make the first server added the default
    }
}

export function listServers(): McpServerConfig[] {
    const servers = config.get('servers', []);
    const defaultName = config.get('defaultServerName');
    return servers.map(s => ({ ...s, default: s.name === defaultName }));
}

export function getServer(name: string): McpServerConfig | undefined {
    const servers = listServers(); // Use listServers to get 'default' status
    return servers.find(s => s.name === name);
}

export function removeServer(name: string): void {
    let servers = config.get('servers', []);
    const serverExists = servers.some(s => s.name === name);
    if (!serverExists) {
        console.log(chalk.yellow(`Server "${name}" not found.`));
        return;
    }
    servers = servers.filter(s => s.name !== name);
    config.set('servers', servers);
    console.log(chalk.green(`Server "${name}" removed.`));

    if (config.get('defaultServerName') === name) {
        config.set('defaultServerName', servers.length > 0 ? servers[0].name : null);
        if (servers.length > 0) {
            console.log(chalk.blue(`Default server was removed. New default set to "${servers[0].name}".`));
        } else {
            console.log(chalk.blue(`Default server was removed. No servers left to set as default.`));
        }
    }
}

export function setDefaultServer(name: string): void {
    const servers = config.get('servers', []);
    if (!servers.some(s => s.name === name)) {
        console.log(chalk.red(`Server "${name}" not found. Cannot set as default.`));
        return;
    }
    config.set('defaultServerName', name);
    console.log(chalk.green(`Server "${name}" is now the default.`));
}

export function getDefaultServer(): McpServerConfig | undefined {
    const defaultName = config.get('defaultServerName');
    if (!defaultName) return undefined;
    return getServer(defaultName);
}
