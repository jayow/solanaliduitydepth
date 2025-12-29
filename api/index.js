// Vercel serverless function wrapper for Express app
import app from '../server/index.js';

// Vercel expects a default export that handles requests
// For Vercel serverless functions, we need to handle the request/response properly
export default async (req, res) => {
  // Ensure environment variables are available
  // Vercel automatically injects them, but we log to verify
  if (process.env.JUPITER_API_KEY) {
    console.log('JUPITER_API_KEY is configured');
  } else {
    console.warn('⚠️ JUPITER_API_KEY is NOT configured in Vercel environment');
  }
  
  // Handle the request with Express app
  return app(req, res);
};

