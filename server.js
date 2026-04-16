/**
 * Spyro Fans — Express API Server
 * Entry point: node server.js
 * Default port: 3001  (frontend static files served separately)
 */

'use strict';

const express = require('express');
const cors    = require('cors');

const serviceRequestRoutes = require('./routes/serviceRequest');
const newLeadRoutes        = require('./routes/newLead');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ── Middleware ─────────────────────────────────────── */
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'null'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Health check ───────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ── Routes ─────────────────────────────────────────── */
app.use('/api/service-request', serviceRequestRoutes);
app.use('/api/new-lead',        newLeadRoutes);

/* ── 404 fallback ───────────────────────────────────── */
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
});

/* ── Global error handler ───────────────────────────── */
app.use((err, req, res, next) => {  // eslint-disable-line no-unused-vars
  console.error('[Spyro API Error]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

/* ── Start ──────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`[Spyro API] Server running on http://localhost:${PORT}`);
});

module.exports = app;
