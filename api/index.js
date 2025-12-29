// Vercel serverless function wrapper for Express app
import app from '../server/index.js';

// Export the Express app directly for Vercel
// Vercel will handle the routing automatically
export default app;

