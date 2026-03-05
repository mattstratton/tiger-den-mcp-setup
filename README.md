# Tiger Den MCP Setup

CLI installer to configure the Tiger Den MCP server for Claude Desktop.

## Requirements

- Node.js 18+
- Claude Desktop installed

## Install Tiger Den MCP

Run:

```bash
npx -y @mattstratton/tiger-den-mcp-setup
```

The installer will:
- Prompt for your Tiger Den API key
- Locate your Claude Desktop settings.json
- Configure the Tiger Den MCP server
- Create a backup if needed

Restart Claude Desktop after installation.

## Doctor Mode

To verify your setup without modifying files:

```bash
npx -y @mattstratton/tiger-den-mcp-setup --doctor
```
