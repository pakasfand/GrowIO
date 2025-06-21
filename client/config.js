// Configuration for different environments
const config = {
    development: {
        serverUrl: 'ws://localhost:8080'
    },
    production: {
        // Auto-detect server URL from current page
        get serverUrl() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.hostname;
            const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
            return `${protocol}//${host}:${port}`;
        }
    }
};

// Auto-detect environment
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const currentConfig = isDevelopment ? config.development : config.production;

export default currentConfig; 