import { statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { inspect, parsePreset, presetSettings, VERSION } from '@pixel3d/core';
import type { Preset, Report } from '@pixel3d/core';
import { runConvert, UsageError } from './convertCmd';
import { parsePresetJson } from './presetLoad';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const json = (v: unknown) => JSON.stringify(v, null, 2);

/** Run a tool body so that any thrown error becomes a plain `isError` result instead of crashing the server. */
const guarded = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await fn();
  } catch (e) {
    return text(e instanceof Error ? e.message : String(e), true);
  }
};

const presetShape = {
  preset: z.record(z.string(), z.unknown()).optional().describe('Inline preset object: {version: 1, settings: {...}, colourRules: [...]}. Give this or presetPath, not both.'),
  presetPath: z.string().optional().describe('Path to a preset JSON file. Give this or preset, not both.'),
  out: z.string().describe('Output folder for the models and report.json. Created if missing.'),
  format: z.enum(['stl', '3mf']).optional().describe('Overrides the preset export format.'),
};

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** One line describing what a preset does, e.g. "base 2 mm, halves, loop, 3 color rules". */
export function presetSummary(p: Preset): string {
  const s = presetSettings(p);
  const parts = [s.base.enabled ? `base ${s.base.height} mm` : 'no base', s.sides.mode];
  if (s.keychain.type !== 'none') parts.push(s.keychain.type);
  const n = p.colourRules.length;
  if (n) parts.push(`${n} color ${n === 1 ? 'rule' : 'rules'}`);
  return parts.join(', ');
}

/** The px3d MCP server with its four tools. Paths resolve against the process working directory. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'px3d', version: VERSION });

  server.registerTool(
    'convert_image',
    {
      description: 'Convert one pixel-art image (.png .jpg .jpeg .gif .webp) to a 3D-print model (3MF or STL) written into the out folder. Returns the conversion report.',
      inputSchema: { path: z.string().describe('Path to the image.'), ...presetShape },
    },
    async (a) => guarded(async () => {
      const { reports, failures } = await runConvert({ inputs: [a.path], presetPath: a.presetPath, preset: a.preset, out: a.out, format: a.format });
      const r = reports[0] as Report;
      const summary = failures ? `${basename(a.path)} failed: ${r.error}` : `${basename(a.path)} converted: ${r.files.join(', ')} written to ${resolve(a.out)}`;
      return text(`${summary}\n${json(r)}`, failures > 0);
    }),
  );

  server.registerTool(
    'convert_folder',
    {
      description: 'Convert every image in a folder (not recursive) to 3D-print models in the out folder, and write report.json there. Returns a summary and the per-image reports.',
      inputSchema: { dir: z.string().describe('Folder containing the images.'), ...presetShape },
    },
    async (a) => guarded(async () => {
      if (!isDir(a.dir)) throw new UsageError(`Not a folder: ${a.dir}`);
      const { reports, failures } = await runConvert({ inputs: [a.dir], presetPath: a.presetPath, preset: a.preset, out: a.out, format: a.format });
      return text(`${reports.length - failures} converted, ${failures} failed. report.json written to ${resolve(a.out)}\n${json(reports)}`);
    }),
  );

  server.registerTool(
    'inspect_image',
    {
      description: 'Inspect an image before converting it: size, detected pixel scale, whether it looks like pixel art, and its palette (hex + count per color, most frequent first). Use this when writing color rules for a preset.',
      inputSchema: { path: z.string().describe('Path to the image.') },
    },
    async (a) => guarded(async () => text(json(await inspect(new Uint8Array(await readFile(a.path)))))),
  );

  server.registerTool(
    'list_presets',
    {
      description: 'List the preset JSON files (*.json) in a folder, each with a one-line summary, or its error when the preset is invalid.',
      inputSchema: { dir: z.string().optional().describe('Folder to look in. Defaults to the server working directory.') },
    },
    async (a) => guarded(async () => {
      const dir = a.dir ?? process.cwd();
      const files = (await readdir(dir)).filter((f) => extname(f).toLowerCase() === '.json').sort();
      const list: { name: string; path: string; summary?: string; error?: string }[] = [];
      for (const f of files) {
        const path = resolve(join(dir, f));
        const name = basename(f, extname(f));
        try {
          list.push({ name, path, summary: presetSummary(parsePreset(parsePresetJson(await readFile(path, 'utf8')))) });
        } catch (e) {
          list.push({ name, path, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return text(json(list));
    }),
  );

  return server;
}

/** `px3d mcp`: serve MCP over stdio until the client disconnects. stdout carries the protocol, so logs go to stderr only. */
export async function mcpCmd(_argv: string[]): Promise<number> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`px3d ${VERSION} MCP server ready on stdio`);
  await new Promise<void>((done) => {
    server.server.onclose = () => done();
    process.stdin.once('end', () => done());
  });
  return 0;
}
