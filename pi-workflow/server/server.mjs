#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const planFilePath = process.argv[2];
if (!planFilePath) {
  console.error('Usage: node server.mjs <plan-file-path> [output-file-path]');
  process.exit(1);
}

const outputFilePath = process.argv[3] || planFilePath.replace(/\.md$/, '.annotations.md');

let planContent;
try {
  planContent = fs.readFileSync(planFilePath, 'utf-8');
} catch (err) {
  console.error(`Failed to read plan file: ${planFilePath}`);
  process.exit(1);
}

const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlContent);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/plan') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ content: planContent, filePath: planFilePath }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/submit') {
    const MAX_BODY = 5 * 1024 * 1024; // 5 MB
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const output = formatAnnotatedPlan(data);
        fs.writeFileSync(outputFilePath, output, 'utf-8');

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ success: true, outputPath: outputFilePath }));

        console.log(`PLAN_REVIEW_COMPLETE:${outputFilePath}`);

        // Bring the terminal back to focus
        if (process.platform === 'darwin') {
          try {
            // Use TERM_PROGRAM env var to detect the exact terminal app
            const termProgram = process.env.TERM_PROGRAM || '';
            const termMap = {
              'iTerm.app': 'iTerm',
              'Apple_Terminal': 'Terminal',
              'WarpTerminal': 'Warp',
              'Alacritty': 'Alacritty',
              'WezTerm': 'WezTerm',
              'vscode': 'Visual Studio Code',
              'cursor': 'Cursor',
              'claude': 'Claude',
            };
            const appName = termMap[termProgram] || termProgram;
            if (appName) {
              execSync(`open -a "${appName}"`, { timeout: 3000 });
            }
          } catch {
            // Best-effort — terminal focus is not critical
          }
        }

        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 500);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function formatAnnotatedPlan(data) {
  const lines = [];

  lines.push('# Plan Review Annotations');
  lines.push('');
  lines.push(`**Plan file:** \`${planFilePath}\``);
  lines.push(`**Reviewed at:** ${new Date().toISOString()}`);
  lines.push('');

  if (data.deletedSections && data.deletedSections.length > 0) {
    lines.push('## Deleted Sections');
    lines.push('');
    lines.push('Remove these sections entirely from the plan file:');
    lines.push('');
    for (const section of data.deletedSections) {
      lines.push(`### ~~${section.heading}~~`);
      lines.push('');
      if (section.lines) lines.push(`**Lines:** ${section.lines}`);
      lines.push('');
      if (section.rawMarkdown) {
        lines.push('**Raw markdown to delete:**');
        lines.push('');
        lines.push('```markdown');
        lines.push(section.rawMarkdown);
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (data.deletedSelections && data.deletedSelections.length > 0) {
    lines.push('## Deleted Text');
    lines.push('');
    lines.push('Remove the following text from the plan. The selected text is from the rendered view — find the matching content in the raw markdown section shown below:');
    lines.push('');
    for (let i = 0; i < data.deletedSelections.length; i++) {
      const sel = data.deletedSelections[i];
      lines.push(`### Deleted Text ${i + 1}`);
      lines.push('');
      if (sel.sectionHeading) {
        lines.push(`**In section:** ${sel.sectionHeading}`);
      }
      if (sel.lines) lines.push(`**Lines:** ${sel.lines}`);
      lines.push('');
      lines.push('**Selected text (rendered):** ' + sel.selectedText);
      lines.push('');
      if (sel.rawMarkdown) {
        lines.push('<details><summary>Section raw markdown (for reference)</summary>');
        lines.push('');
        lines.push('```markdown');
        lines.push(sel.rawMarkdown);
        lines.push('```');
        lines.push('</details>');
        lines.push('');
      }
    }
  }

  if (data.edits && data.edits.length > 0) {
    lines.push('## Edits');
    lines.push('');
    lines.push('Apply the following text replacements. The selected text is from the rendered view — find the matching content in the raw markdown section shown below:');
    lines.push('');
    for (let i = 0; i < data.edits.length; i++) {
      const edit = data.edits[i];
      lines.push(`### Edit ${i + 1}`);
      lines.push('');
      if (edit.sectionHeading) {
        lines.push(`**In section:** ${edit.sectionHeading}`);
      }
      if (edit.lines) lines.push(`**Lines:** ${edit.lines}`);
      lines.push('');
      lines.push('**Original text (rendered):** ~~' + edit.originalText + '~~');
      lines.push('');
      lines.push('**Replace with:** ' + edit.newText);
      lines.push('');
      if (edit.rawMarkdown) {
        lines.push('<details><summary>Section raw markdown (for reference)</summary>');
        lines.push('');
        lines.push('```markdown');
        lines.push(edit.rawMarkdown);
        lines.push('```');
        lines.push('</details>');
        lines.push('');
      }
    }
  }

  if (data.annotations && data.annotations.length > 0) {
    lines.push('## Annotations');
    lines.push('');
    lines.push('Apply the feedback from each comment to the plan. The selected text is from the rendered view — find the matching content in the raw markdown section shown below:');
    lines.push('');
    for (let i = 0; i < data.annotations.length; i++) {
      const annotation = data.annotations[i];
      lines.push(`### Annotation ${i + 1}`);
      lines.push('');
      if (annotation.sectionHeading) {
        lines.push(`**In section:** ${annotation.sectionHeading}`);
      }
      if (annotation.lines) lines.push(`**Lines:** ${annotation.lines}`);
      lines.push('');
      lines.push('**Selected text (rendered):** ' + annotation.selectedText);
      lines.push('');
      lines.push('**Comment:** ' + annotation.comment);
      lines.push('');
      if (annotation.rawMarkdown) {
        lines.push('<details><summary>Section raw markdown (for reference)</summary>');
        lines.push('');
        lines.push('```markdown');
        lines.push(annotation.rawMarkdown);
        lines.push('```');
        lines.push('</details>');
        lines.push('');
      }
    }
  }

  if (data.generalComments) {
    lines.push('## General Comments');
    lines.push('');
    lines.push('Apply the following overall feedback to the plan. These are actionable instructions — make the requested changes:');
    lines.push('');
    lines.push(data.generalComments);
    lines.push('');
  }

  if (
    (!data.deletedSections || data.deletedSections.length === 0) &&
    (!data.deletedSelections || data.deletedSelections.length === 0) &&
    (!data.edits || data.edits.length === 0) &&
    (!data.annotations || data.annotations.length === 0) &&
    !data.generalComments
  ) {
    lines.push('## No Changes');
    lines.push('');
    lines.push('The plan was approved as-is with no annotations or deletions.');
    lines.push('');
  }

  return lines.join('\n');
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  console.log(`PLAN_REVIEW_URL:${url}`);

  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'linux') {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Browser open is best-effort
  }
});
