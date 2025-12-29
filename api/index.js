// Vercel serverless function wrapper for Express app
// This file handles requests to /api/* routes

export default async function handler(req, res) {
  // Dynamically import the Express app to handle any initialization errors
  try {
    const { default: app } = await import('../server/index.js');
    
    // Let Express handle the request
    return new Promise((resolve, reject) => {
      app(req, res);
      res.on('finish', resolve);
      res.on('error', reject);
    });
  } catch (error) {
    console.error('Failed to load Express app:', error);
    res.status(500).json({ 
      error: 'Server initialization failed', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
