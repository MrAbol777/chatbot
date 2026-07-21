# SMS Service Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend / Client                        │
│                    (React, Mobile App, etc.)                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP Requests
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express Server (server.js)                  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              SMS Routes (/api/sms/*)                       │ │
│  │                                                            │ │
│  │  • POST /send-otp      → Send OTP code                    │ │
│  │  • POST /verify-otp    → Verify OTP code                  │ │
│  │  • POST /send          → Send custom SMS                  │ │
│  │  • POST /send-bulk     → Send bulk SMS                    │ │
│  └──────────────────────┬─────────────────────────────────────┘ │
│                         │                                         │
│                         │ Calls                                   │
│                         ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │           SMS Service (smsService.js)                      │ │
│  │                                                            │ │
│  │  • generateOTP()       → Generate random OTP              │ │
│  │  • sendSMS()           → Send SMS via IPPanel             │ │
│  │  • sendOTP()           → Generate & send OTP              │ │
│  │  • sendCustomOTP()     → Send with custom template        │ │
│  │  • sendBulkSMS()       → Send to multiple recipients      │ │
│  └──────────────────────┬─────────────────────────────────────┘ │
│                         │                                         │
└─────────────────────────┼─────────────────────────────────────────┘
                          │
                          │ HTTPS POST
                          │ Authorization: API_KEY
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    IPPanel SMS Gateway                           │
│                  https://edge.ippanel.com/v1                     │
│                                                                   │
│  Endpoint: POST /sms/send                                        │
│  Headers:                                                        │
│    - Authorization: <API_KEY>                                    │
│    - Content-Type: application/json                              │
│                                                                   │
│  Body:                                                           │
│    {                                                             │
│      "from": "SENDER_NUMBER",                                    │
│      "to": ["PHONE_NUMBER"],                                     │
│      "text": "MESSAGE_TEXT"                                      │
│    }                                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ SMS Delivery
                             │
                             ▼
                    ┌────────────────┐
                    │  User's Phone  │
                    │  09XXXXXXXXX   │
                    └────────────────┘
```

## Data Flow: Send OTP

```
1. Client Request
   POST /api/sms/send-otp
   Body: { "phone": "09123456789" }
   
   ↓

2. Route Handler (smsRoutes.js)
   - Validate phone number format
   - Check rate limiting (1 OTP/min)
   - Call smsService.sendOTP()
   
   ↓

3. SMS Service (smsService.js)
   - Generate 6-digit OTP
   - Create message: "کد تایید شما: 123456"
   - Call IPPanel API
   
   ↓

4. IPPanel API
   POST https://edge.ippanel.com/v1/sms/send
   Headers: Authorization: <API_KEY>
   Body: {
     "from": "SENDER_NUMBER",
     "to": ["09123456789"],
     "text": "کد تایید شما: 123456"
   }
   
   ↓

5. Store OTP
   otpStore.set("09123456789", {
     otp: "123456",
     timestamp: Date.now()
   })
   
   ↓

6. Response to Client
   {
     "success": true,
     "message": "OTP sent successfully",
     "phone": "09123456789",
     "expiresIn": 300
   }
```

## Data Flow: Verify OTP

```
1. Client Request
   POST /api/sms/verify-otp
   Body: { "phone": "09123456789", "otp": "123456" }
   
   ↓

2. Route Handler
   - Validate phone and OTP
   - Retrieve stored OTP from otpStore
   - Check expiry (5 minutes)
   - Compare OTP values
   
   ↓

3. Response
   Success: { "success": true, "message": "OTP verified successfully" }
   Failure: { "success": false, "error": "Invalid OTP" }
```

## OTP Storage (In-Memory)

```
┌─────────────────────────────────────────────────────────┐
│              otpStore (Map)                              │
│                                                          │
│  Key: "09123456789"                                     │
│  Value: {                                               │
│    otp: "123456",                                       │
│    timestamp: 1715443200000                             │
│  }                                                      │
│                                                          │
│  • Expires after 5 minutes                              │
│  • Cleaned up every 60 seconds                          │
│  • Rate limited: 1 OTP per minute per phone             │
└─────────────────────────────────────────────────────────┘
```

## Security Layers

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Input Validation                              │
│  • Phone format: 09XXXXXXXXX                            │
│  • Message length limits                                │
│  • Array validation for bulk SMS                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Rate Limiting                                 │
│  • Max 1 OTP per minute per phone                       │
│  • Prevents SMS bombing                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3: OTP Expiry                                    │
│  • 5-minute validity window                             │
│  • Automatic cleanup of expired OTPs                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 4: API Authentication                            │
│  • IPPanel API key in environment variable              │
│  • HTTPS communication only                             │
└─────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
Try to send SMS
    │
    ├─→ Missing API Key
    │   └─→ Return: { success: false, error: "API key not configured" }
    │
    ├─→ Invalid Phone Format
    │   └─→ Return: { success: false, error: "Invalid phone number" }
    │
    ├─→ Rate Limit Exceeded
    │   └─→ Return: { success: false, error: "Wait before requesting" }
    │
    ├─→ IPPanel API Error
    │   └─→ Log error + Return: { success: false, error: "Failed to send" }
    │
    └─→ Success
        └─→ Return: { success: true, data: {...} }
```

## Integration Points

### 1. Environment Configuration
```
.env file
├── IPPANEL_API_KEY          (Required)
```

### 2. Server Integration
```javascript
// server.js
const smsRoutes = require('./routes/smsRoutes');
app.use('/api/sms', smsRoutes);
```

### 3. Service Usage
```javascript
// Any module
const smsService = require('./services/smsService');
await smsService.sendOTP('09123456789');
```

## Scalability Considerations

### Current (Single Server)
```
┌──────────────┐
│   Server     │
│  (In-Memory  │
│  OTP Store)  │
└──────────────┘
```

### Production (Multiple Servers)
```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Server 1    │    │  Server 2    │    │  Server 3    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    Redis     │
                    │ (Shared OTP  │
                    │   Storage)   │
                    └──────────────┘
```

## Monitoring Points

```
1. SMS Send Success Rate
   └─→ Track: result.success in smsService.sendSMS()

2. OTP Generation Rate
   └─→ Track: Calls to generateOTP()

3. OTP Verification Success Rate
   └─→ Track: Success/failure in /verify-otp endpoint

4. Rate Limit Hits
   └─→ Track: 429 responses in /send-otp

5. API Response Times
   └─→ Track: IPPanel API latency

6. Error Rates
   └─→ Track: Errors logged in smsService
```

---

**Architecture Version:** 1.0  
**Last Updated:** 2025  
**Status:** Production Ready
