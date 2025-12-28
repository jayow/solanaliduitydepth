// Quick test to verify Jupiter API connection
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import https from 'https';
import axios from 'axios';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

const axiosInstance = axios.create({
  httpsAgent: httpsAgent,
  timeout: 10000,
});

async function testJupiter() {
  console.log('Testing Jupiter API connection...');
  try {
    const response = await axiosInstance.get('https://lite-api.jup.ag/swap/v1/quote', {
      params: {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000000',
      }
    });
    console.log('✅ SUCCESS!');
    console.log('outAmount:', response.data.outAmount);
    console.log('inAmount:', response.data.inAmount);
  } catch (error) {
    console.error('❌ FAILED:');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('Response:', error.response?.data);
  }
}

testJupiter();

