#!/usr/bin/env node
// Prints the CHANGELOG section for one version, so a release body does not have
// to be pasted in by hand. Usage: node scripts/release-notes.js [version]
const fs = require('fs');
const path = require('path');

const version = (process.argv[2] || require('../package.json').version).replace(/^v/, '');
const changelog = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');

// Sections look like "# v1.7.0" and run until the next "# v..." heading.
const lines = changelog.split(/\r?\n/);
const heading = new RegExp(`^#\\s*v?${version.replace(/\./g, '\\.')}\\s*$`);
const nextHeading = /^#\s*v?\d+\.\d+/;

const start = lines.findIndex((line) => heading.test(line));
if (start === -1) {
  process.stderr.write(`No CHANGELOG section for v${version}\n`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => nextHeading.test(line));
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

if (!body) {
  process.stderr.write(`CHANGELOG section for v${version} is empty\n`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
