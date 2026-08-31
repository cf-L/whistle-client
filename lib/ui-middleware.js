const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '../public/pm');

// Anthropic Sans ships with Claude Desktop. When that app is installed we serve
// the font straight from its bundle so the UI matches; nothing is copied into
// this repo, and the CSS falls back to the system face when it is absent.
const CLAUDE_FONTS = '/Applications/Claude.app/Contents/Resources/fonts';
const FONT_ALIASES = {
  '/fonts/anthropic-sans.ttf': `${CLAUDE_FONTS}/AnthropicSans-Romans-Variable-25x258.ttf`,
  '/fonts/anthropic-sans-italic.ttf': `${CLAUDE_FONTS}/AnthropicSans-Italics-Variable-25x258.ttf`,
};
const PREFIX = '/pm';
const MAX_AGE = 0;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const send = (req, res, file) => {
  let body;
  try {
    body = fs.readFileSync(file);
  } catch (e) {
    res.statusCode = 404;
    return res.end('Not Found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', `no-cache, max-age=${MAX_AGE}`);
  const accept = req.headers['accept-encoding'] || '';
  if (accept.includes('gzip') && body.length > 1024) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.end(zlib.gzipSync(body));
  }
  res.end(body);
};

// Mounted through whistle's `uiMiddleware` option, so the modern UI is served
// by whistle's own web server and shares its origin with the /cgi-bin APIs.
module.exports = (req, res, next) => {
  const pathname = req.url.split('?')[0];
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) {
    return next();
  }
  let rel = pathname.slice(PREFIX.length) || '/';
  if (rel === '/' || rel === '') {
    rel = '/index.html';
  }
  const alias = FONT_ALIASES[rel];
  if (alias) {
    if (!fs.existsSync(alias)) {
      res.statusCode = 404;
      return res.end('Not Found');
    }
    return send(req, res, alias);
  }
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  return send(req, res, file);
};
