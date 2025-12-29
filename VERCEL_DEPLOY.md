# Vercel Deployment Guide

This project is configured for deployment on Vercel.

## Prerequisites

1. A Vercel account (sign up at https://vercel.com)
2. Your GitHub repository pushed to GitHub
3. Your Jupiter API key (if using paid API)

## Deployment Steps

### Option 1: Deploy via Vercel CLI (Recommended)

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy to production:
   ```bash
   vercel --prod
   ```

   Or deploy to preview:
   ```bash
   vercel
   ```

### Option 2: Deploy via Vercel Dashboard

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Vercel will automatically detect the configuration from `vercel.json`
4. Configure environment variables (see below)
5. Click "Deploy"

## Environment Variables

You need to set the following environment variables in Vercel:

1. **JUPITER_API_KEY** (Required if using paid API)
   - Your Jupiter API key
   - Go to: Project Settings → Environment Variables
   - Add: `JUPITER_API_KEY` = `your-api-key-here`

2. **NODE_TLS_REJECT_UNAUTHORIZED** (Optional)
   - Already set in `vercel.json` to `0`
   - Only modify if you have SSL certificate issues

## Project Configuration

- **Build Command**: `cd client && npm install && npm run build`
- **Output Directory**: `client/dist`
- **API Routes**: All `/api/*` requests are routed to `/api/index.js` (serverless function)
- **Static Files**: All other requests serve the React app from `client/dist`

## Important Notes

1. The server automatically detects Vercel environment and won't start a local server
2. All API routes are handled by Vercel serverless functions
3. The frontend is built as a static site and served by Vercel
4. Make sure your `JUPITER_API_KEY` is set in Vercel's environment variables

## Troubleshooting

- If API routes don't work, check that `api/index.js` exists and exports the Express app correctly
- If build fails, ensure all dependencies are listed in `package.json`
- Check Vercel build logs for detailed error messages

