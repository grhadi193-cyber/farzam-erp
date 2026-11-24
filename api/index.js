'use strict';
// Vercel serverless entry point: the whole Express app runs as one function.
// vercel.json rewrites every route here; static files in /public are served
// by Vercel's filesystem first.
module.exports = require('../server.js');
