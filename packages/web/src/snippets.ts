/** Port the Batch dialog's HTTP examples use: `px3d serve`'s default (spec §6). */
export const API_PORT = 7300;

/**
 * The Batch dialog's commands for a preset saved as `<name>.json`: the CLI over a folder, the local HTTP API with
 * curl, and the Python example over the same API. packages/cli/test/snippets.test.ts runs every command line here.
 */
export function batchSnippets(name: string): string {
  const preset = `${name}.json`;
  return [
    '# Convert a whole folder from the command line',
    '# (from a clone of the repo: npm run dev:cli -- convert ...)',
    `px3d convert ./sprites --out ./models --preset ${preset}`,
    '',
    '# or over the local HTTP API: start the server, then post an image and the preset',
    `px3d serve --port ${API_PORT}`,
    `curl -OJ -F image=@ghost.png -F preset=@${preset} http://127.0.0.1:${API_PORT}/convert`,
    '',
    '# or from Python, over the same API',
    `python examples/python/convert.py ghost.png ${preset} --out ./models`,
  ].join('\n');
}
