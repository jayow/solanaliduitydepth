// Vercel serverless function wrapper for Express app
import app from '../server/index.js';

// Vercel expects a default export that handles requests
export default (req, res) => {
  return app(req, res);
};

