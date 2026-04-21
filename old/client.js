const nkn = require('nkn-sdk');

// Create a client (auto-generates keypair)
const client = new nkn.Client();

// When connected to NKN network
client.on('connect', () => {
  console.log('✅ Connected to NKN network');
  console.log('My address:', client.addr);
});

// Handle incoming messages
client.on('message', (msg) => {
  const { src, payload } = msg;
  console.log(`📩 Message from ${src}:`, payload.toString());
});

// Wait until ready before sending
client.on('connect', async () => {
  try {
    // Replace with another client's address
    const destination = "ec4d5a9c90db1c4c28d4887cdbb3670b2af675e25f324362dddc78a41e2106d4";

    await client.send(destination, "Hello from NKN 🚀");
    console.log('📤 Message sent');
  } catch (err) {
    console.error('❌ Send failed:', err);
  }
});
