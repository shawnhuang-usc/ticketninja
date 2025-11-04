import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import eventsRouter from './src/routes/events.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/favicon.ico', (req, res) => res.status(204));

app.use('/api', eventsRouter);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
