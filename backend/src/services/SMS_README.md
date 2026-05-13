# IPPanel SMS Service Integration

Complete SMS service implementation using IPPanel API for sending OTP codes and custom SMS messages.

## Features

- ✅ Send OTP codes with automatic generation
- ✅ Send custom SMS messages
- ✅ Send bulk SMS to multiple recipients
- ✅ OTP verification with expiry (5 minutes)
- ✅ Rate limiting (1 OTP per minute per phone)
- ✅ Iranian phone number validation
- ✅ Comprehensive error handling and logging
- ✅ Production-ready code structure

## Configuration

### Environment Variables

Add these to your `backend/.env` file:

```env
IPPANEL_API_KEY=YTFjMGNjNDctNDBiZC00MWE1LWEyZGEtNDA2N2U5ZjU5MzM3NzI4MzgyNmI5MTBkMDQ1MDhmZDZiYjEwNTg2Y2Q5Mjg=
```

## API Endpoints

### 1. Send OTP

**Endpoint:** `POST /api/sms/send-otp`

**Request Body:**
```json
{
  "phone": "09123456789"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "phone": "09123456789",
  "expiresIn": 300
}
```

**Error Responses:**
- `400`: Invalid phone number format
- `429`: Rate limit exceeded (wait before requesting another OTP)
- `500`: Failed to send OTP

### 2. Verify OTP

**Endpoint:** `POST /api/sms/verify-otp`

**Request Body:**
```json
{
  "phone": "09123456789",
  "otp": "123456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "phone": "09123456789"
}
```

**Error Responses:**
- `400`: Missing phone or OTP
- `401`: Invalid OTP
- `404`: No OTP found for this phone
- `410`: OTP has expired

### 3. Send Custom SMS

**Endpoint:** `POST /api/sms/send`

**Request Body:**
```json
{
  "phone": "09123456789",
  "message": "Your custom message here"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "SMS sent successfully",
  "data": { /* IPPanel API response */ }
}
```

### 4. Send Bulk SMS

**Endpoint:** `POST /api/sms/send-bulk`

**Request Body:**
```json
{
  "phones": ["09123456789", "09987654321"],
  "message": "Bulk message to all recipients"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Bulk SMS sent successfully",
  "recipientCount": 2,
  "data": { /* IPPanel API response */ }
}
```

## Usage Examples

### Using the SMS Service Directly

```javascript
const smsService = require('./services/smsService');

// Send OTP
const result = await smsService.sendOTP('09123456789');
if (result.success) {
  console.log('OTP sent:', result.otp);
}

// Send custom SMS
await smsService.sendSMS('09123456789', 'Hello from IPPanel!');

// Send bulk SMS
await smsService.sendBulkSMS(
  ['09123456789', '09987654321'],
  'Bulk message'
);

// Send custom OTP with template
await smsService.sendCustomOTP(
  '09123456789',
  '123456',
  'Your verification code is: {otp}'
);
```

### Frontend Integration Example

```javascript
// Send OTP
const response = await fetch('/api/sms/send-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '09123456789' })
});
const data = await response.json();

// Verify OTP
const verifyResponse = await fetch('/api/sms/verify-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    phone: '09123456789',
    otp: '123456'
  })
});
```

## Security Features

- **Rate Limiting:** Maximum 1 OTP per minute per phone number
- **OTP Expiry:** OTPs expire after 5 minutes
- **Phone Validation:** Only Iranian phone numbers (09XXXXXXXXX) are accepted
- **Automatic Cleanup:** Expired OTPs are automatically removed every minute
- **Error Handling:** Comprehensive error logging and user-friendly error messages

## Production Considerations

⚠️ **Important:** The current implementation stores OTPs in memory (Map). For production:

- Use **Redis** for distributed OTP storage
- Implement proper session management
- Add monitoring and alerting for SMS failures
- Consider implementing SMS delivery status webhooks
