const { AccessToken } = require('livekit-server-sdk');
const readline = require('readline');

// ===== CONFIGURE THESE =====
const apiKey = 'mykey123';       // Your LiveKit API key
const apiSecret = 'f9A3kL8pQ2xM7vD1rS6bH0tW4nZ5yUeK'; // Your LiveKit API secret
const room = 'test';         // Room name everyone will join
// ===========================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter friend name (identity): ', async (identity) => {
  try {
    const token = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 * 60 * 24 * 365 * 100 }); // 100 years
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canPublishData: true,
      canUpdateOwnMetadata: true
    });

    // Await the JWT string
    const jwt = await token.toJwt();

    console.log('\n=== JWT Token ===');
    console.log(jwt);
    console.log('================\n');
  } catch (err) {
    console.error('Error generating JWT:', err);
  } finally {
    rl.close();
  }
});
