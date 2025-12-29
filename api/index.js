// Vercel serverless function wrapper for Express app
import app from '../server/index.js';

// Vercel expects a default export that handles requests
// For Vercel serverless functions, we need to handle the request/response properly
export default async (req, res) => {
  // Ensure environment variables are available
  // Vercel automatically injects them, but we log to verify
  if (process.env.JUPITER_API_KEY) {
    console.log('✅ JUPITER_API_KEY is configured in Vercel');
  } else {
    console.error('❌ JUPITER_API_KEY is NOT configured in Vercel environment');
  }
  
  // Vercel serverless functions need to handle the request properly
  // The Express app will handle routing internally
  try {
    await app(req, res);
  } catch (error) {
    console.error('Error in serverless function:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }
};

