import { readdir, readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { default: mermaid } = await import("mermaid");

const mermaidFence = /^\s*(`{3,}|~{3,})\s*mermaid(?:\s+.*)?$/i;

function extractMermaidBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(mermaidFence);
    if (!opening) continue;

    const fence = opening[1];
    const closingFence = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    const startLine = index + 2;
    const content = [];

    index += 1;
    while (index < lines.length && !closingFence.test(lines[index])) {
      content.push(lines[index]);
      index += 1;
    }

    if (index === lines.length) {
      throw new Error(`Mermaid code fence opened at line ${startLine - 1} is not closed`);
    }

    blocks.push({ content: content.join("\n"), line: startLine });
  }

  return blocks;
}

async function allMarkdownFiles(directory = ".") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      files.push(...(await allMarkdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

async function markdownFiles() {
  const argumentsFromHook = process.argv.slice(2).filter((file) => file.endsWith(".md"));
  return argumentsFromHook.length > 0
    ? [...new Set(argumentsFromHook)]
    : (await allMarkdownFiles()).sort();
}

mermaid.initialize({ startOnLoad: false });

let diagramCount = 0;
let errorCount = 0;

for (const file of await markdownFiles()) {
  let blocks;
  try {
    blocks = extractMermaidBlocks(await readFile(file, "utf8"));
  } catch (error) {
    errorCount += 1;
    console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  for (const block of blocks) {
    diagramCount += 1;
    try {
      await mermaid.parse(block.content);
    } catch (error) {
      errorCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${file}:${block.line}: invalid Mermaid diagram\n${message}`);
    }
  }
}

if (errorCount > 0) {
  console.error(`\nMermaid check failed: ${errorCount} error(s) in ${diagramCount} diagram(s).`);
  process.exit(1);
}

console.log(`Mermaid check passed: ${diagramCount} diagram(s).`);
