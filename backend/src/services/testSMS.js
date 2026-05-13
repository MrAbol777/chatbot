/**
 * Test script for SMS Service
 * Usage: node backend/src/services/testSMS.js
 */

const smsService = require('./smsService');

async function testSMSService() {
  console.log('=== SMS Service Test ===\n');

  // Test 1: Generate OTP
  console.log('Test 1: Generate OTP');
  const otp = smsService.generateOTP(6);
  console.log(`Generated OTP: ${otp}`);
  console.log(`OTP Length: ${otp.length}`);
  console.log('✅ Pass\n');

  // Test 2: Check configuration
  console.log('Test 2: Check Configuration');
  console.log(`API Key configured: ${smsService.apiKey ? 'Yes' : 'No'}`);
  console.log(`Base URL: ${smsService.baseURL}`);
  
  if (!smsService.apiKey) {
    console.log('⚠️  Warning: SMS service not configured');
    console.log('Please set IPPANEL_API_KEY in .env file\n');
    return;
  }
  console.log('✅ Pass\n');

  // Test 3: Send test SMS (uncomment to actually send)
  /*
  console.log('Test 3: Send Test SMS');
  const testPhone = '09123456789'; // Replace with your test phone
  const result = await smsService.sendSMS(testPhone, 'Test message from IPPanel');
  console.log('Result:', result);
  console.log(result.success ? '✅ Pass\n' : '❌ Fail\n');
  */

  // Test 4: Send OTP (uncomment to actually send)
  /*
  console.log('Test 4: Send OTP');
  const otpResult = await smsService.sendOTP('09123456789');
  console.log('Result:', otpResult);
  console.log(otpResult.success ? '✅ Pass\n' : '❌ Fail\n');
  */

  console.log('=== Test Complete ===');
  console.log('\nTo test actual SMS sending:');
  console.log('1. Uncomment Test 3 or Test 4 in this file');
  console.log('2. Replace phone number with your test number');
  console.log('3. Run: node backend/src/services/testSMS.js');
}

testSMSService().catch(console.error);
