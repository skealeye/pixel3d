# pixel3d

Turns pixel art into 3D-print models (3MF or STL): one raised block per pixel, optional base, keychain loop or hole, and magnet pockets. Colours become separate parts so a multi-colour printer can print them.

## Commands

Build the CLI once with `npm install && npm run build:cli` (output: `packages/cli/dist/px3d.mjs`).

```
px3d convert <files|globs|dirs...> --out <dir> [--preset p.json] [--format stl|3mf] [--set key=value ...]
px3d serve [--port 7300] [--host 127.0.0.1] [--debug]   # HTTP API for scripts
px3d mcp                                                 # MCP server for Claude, over stdio
px3d --version
px3d --help
```

## Use with Claude (MCP)

`px3d mcp` gives Claude four tools: `convert_image`, `convert_folder`, `inspect_image` (palette for writing colour rules) and `list_presets`. Relative paths resolve against the folder Claude starts the server in.

Claude Code:

```
claude mcp add px3d -- px3d mcp
```

Claude Desktop (`px3d` may not be on PATH, so call the built bundle with node). Add this to `claude_desktop_config.json`, using the absolute path to your checkout:

```json
{
  "mcpServers": {
    "px3d": {
      "command": "node",
      "args": ["C:/path/to/pixel3d/packages/cli/dist/px3d.mjs", "mcp"]
    }
  }
}
```
