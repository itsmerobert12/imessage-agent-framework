# iMessage AI Agent Framework

A complete, local framework for building AI agents that interact through iMessage.

## Features

- **iMessage Integration** - Agents receive and send messages via Messages.app
- **Agent Factory** - Create any type of AI agent
- **Multi-Agent Support** - Coordinate multiple agents
- **Multi-LLM** - Claude + ChatGPT support
- **Web Search** - Real-time info via Tavily
- **100% Local** - No cloud, complete privacy
- **Full TypeScript** - Type-safe codebase

## Quick Start

```bash
npm install
cp .env.example .env
# Add your API keys to .env
npm run dev:agents
```

## Architecture

```
Messages.app → SQLite Bridge → Agent Factory → LLM → Reply via iMessage
```

## License

MIT
