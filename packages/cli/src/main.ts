import { VERSION } from '@pixel3d/core';
import { convertCmd } from './convertCmd';
import { mcpCmd } from './mcp';
import { serveCmd } from './serve';

export const USAGE = `px3d ${VERSION}: convert pixel art to 3D-print files

Usage:
  px3d convert <files|globs|dirs...> --out|-o <dir> [--preset p.json] [--format stl|3mf] [--set key=value ...]
      Convert images (.png .jpg .jpeg .gif .webp) to models. Writes the models and report.json into <dir>.
      --set sets a settings value by dotted path, e.g. --set base.height=3 (JSON values allowed).
      Exit code: 0 all converted, 1 some image failed, 2 usage or preset error.
  px3d serve [--port 7300] [--host 127.0.0.1] [--debug]
      HTTP API for scripts: POST /convert, POST /batch, GET /jobs/:id, GET /openapi.json.
      Binds to localhost by default. --debug includes error stack excerpts in responses.
  px3d mcp
      MCP server over stdio for Claude (tools: convert_image, convert_folder, inspect_image, list_presets).
      Add it with: claude mcp add px3d -- px3d mcp
  px3d --version
  px3d --help
`;

/** Subcommands: each takes the arguments after its name and resolves to an exit code. */
const commands: Record<string, (argv: string[]) => Promise<number>> = {
  convert: convertCmd,
  serve: serveCmd,
  mcp: mcpCmd,
};

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === '--version' || cmd === '-v') {
    console.log(VERSION);
    return 0;
  }
  if (cmd === undefined) {
    console.error(USAGE);
    return 2;
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    return 0;
  }
  const run = commands[cmd];
  if (run) return run(rest);
  console.error(`Unknown command "${cmd}".

${USAGE}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
