# SMS Service Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. Environment Configuration
- [ ] Add `IPPANEL_API_KEY` to `backend/.env`
- [ ] Verify API key is correct (test with IPPanel dashboard)

### 2. Dependencies
- [x] axios installed (`npm install axios`)
- [x] All other dependencies up to date

### 3. Code Integration
- [x] `smsService.js` created in `backend/src/services/`
- [x] `smsRoutes.js` created in `backend/src/routes/`
- [x] Routes integrated in `server.js`
- [x] Environment variables added to `.env.example`

### 4. Testing
- [ ] Test OTP generation (run `testSMS.js`)
- [ ] Test sending OTP to real phone number
- [ ] Test OTP verification flow
- [ ] Test rate limiting (try sending 2 OTPs within 1 minute)
- [ ] Test OTP expiry (wait 5+ minutes and try to verify)
- [ ] Test invalid phone number format
- [ ] Test custom SMS sending
- [ ] Test bulk SMS (if needed)

### 5. Security Review
- [x] API key stored in environment variable (not hardcoded)
- [x] Rate limiting implemented (1 OTP per minute)
- [x] OTP expiry implemented (5 minutes)
- [x] Phone number validation implemented
- [x] Error messages don't leak sensitive information
- [ ] HTTPS enabled in production
- [ ] CORS configured properly

### 6. Monitoring Setup
- [ ] Log aggregation configured
- [ ] Error tracking setup (e.g., Sentry)
- [ ] SMS delivery monitoring
- [ ] Rate limit alerts configured
- [ ] API failure alerts configured

## 🚀 Deployment Steps

### Step 1: Update Environment Variables
```bash
# Edit backend/.env
nano backend/.env

# Add these lines:
IPPANEL_API_KEY=YTFjMGNjNDctNDBiZC00MWE1LWEyZGEtNDA2N2U5ZjU5MzM3NzI4MzgyNmI5MTBkMDQ1MDhmZDZiYjEwNTg2Y2Q5Mjg=
```

### Step 2: Install Dependencies
```bash
cd backend
npm install
```

### Step 3: Test Configuration
```bash
# Run test script
node src/services/testSMS.js

# Expected output:
# ✅ OTP generation works
# ✅ Configuration is valid
```

### Step 4: Start Server
```bash
# Development
npm run dev

# Production
npm start
```

### Step 5: Test Endpoints
```bash
# Test health check
curl http://localhost:3001/api/health

# Test send OTP
curl -X POST http://localhost:3001/api/sms/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "09123456789"}'

# Expected response:
# {"success": true, "message": "OTP sent successfully", ...}
```

### Step 6: Verify SMS Delivery
- [ ] Check phone for received SMS
- [ ] Verify OTP code format
- [ ] Verify message content is correct
- [ ] Verify sender number is displayed correctly

### Step 7: Test Full Flow
```bash
# 1. Send OTP
curl -X POST http://localhost:3001/api/sms/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "09123456789"}'

# 2. Check phone for OTP code

# 3. Verify OTP
curl -X POST http://localhost:3001/api/sms/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "09123456789", "otp": "123456"}'

# Expected: {"success": true, "message": "OTP verified successfully"}
```

## 📊 Post-Deployment Verification

### Functional Tests
- [ ] OTP sending works
- [ ] OTP verification works
- [ ] Rate limiting works
- [ ] OTP expiry works
- [ ] Custom SMS sending works
- [ ] Bulk SMS works (if implemented)

### Performance Tests
- [ ] Response time < 2 seconds for OTP send
- [ ] Response time < 500ms for OTP verify
- [ ] Server handles concurrent requests

### Security Tests
- [ ] Cannot bypass rate limiting
- [ ] Cannot verify expired OTP
- [ ] Cannot verify wrong OTP
- [ ] Invalid phone numbers rejected
- [ ] API key not exposed in logs

### Error Handling Tests
- [ ] Graceful handling of IPPanel API errors
- [ ] Proper error messages for users
- [ ] Errors logged correctly
- [ ] No sensitive data in error responses

## 🔧 Troubleshooting

### Issue: "IPPANEL_API_KEY is not configured"
**Solution:**
1. Check `.env` file exists in `backend/` directory
2. Verify `IPPANEL_API_KEY` is set
3. Restart the server after adding environment variables

### Issue: "Failed to send SMS"
**Possible causes:**
1. Invalid API key
2. Invalid sender number
3. Network connectivity issues
4. IPPanel service down

**Debug steps:**
```bash
# Check logs
tail -f backend/logs/error.log

# Test API key manually
curl -X POST https://edge.ippanel.com/v1/sms/send \
  -H "Authorization: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"SENDER","to":["09123456789"],"text":"Test"}'
```

### Issue: "Rate limit exceeded"
**Expected behavior:** This is working correctly
**Solution:** Wait 60 seconds before sending another OTP to the same number

### Issue: "OTP has expired"
**Expected behavior:** OTPs expire after 5 minutes
**Solution:** Request a new OTP

### Issue: "Invalid phone number format"
**Solution:** Ensure phone number is in format: `09XXXXXXXXX`
- Must start with `09`
- Must be exactly 11 digits
- No spaces or dashes

## 📈 Monitoring Metrics

### Key Metrics to Track
1. **SMS Send Success Rate**
   - Target: > 99%
   - Alert if: < 95%

2. **OTP Verification Success Rate**
   - Target: > 80%
   - Alert if: < 60%

3. **Average Response Time**
   - Target: < 2 seconds
   - Alert if: > 5 seconds

4. **Rate Limit Hit Rate**
   - Monitor for abuse patterns
   - Alert if: Sudden spike

5. **Error Rate**
   - Target: < 1%
   - Alert if: > 5%

### Log Monitoring
```bash
# Monitor SMS service logs
tail -f backend/logs/app.log | grep SMSService

# Monitor errors
tail -f backend/logs/error.log | grep SMS
```

## 🔄 Maintenance Tasks

### Daily
- [ ] Check error logs
- [ ] Monitor SMS delivery rate
- [ ] Check for unusual patterns

### Weekly
- [ ] Review rate limit hits
- [ ] Check OTP verification success rate
- [ ] Review API response times

### Monthly
- [ ] Review SMS costs
- [ ] Update dependencies
- [ ] Review and optimize OTP expiry time
- [ ] Review rate limiting thresholds

## 🚨 Rollback Plan

If issues occur after deployment:

### Quick Rollback
```bash
# 1. Stop the server
pm2 stop backend

# 2. Revert to previous version
git revert HEAD

# 3. Restart server
pm2 start backend
```

### Disable SMS Feature
```javascript
// In server.js, comment out:
// app.use('/api/sms', smsRoutes);

// Restart server
```

## 📞 Support Contacts

- **IPPanel Support:** [IPPanel Dashboard](https://edge.ippanel.com)
- **API Documentation:** https://edge.ippanel.com/docs
- **Technical Issues:** Check `SMS_README.md` and `SMS_ARCHITECTURE.md`

## ✅ Sign-off

- [ ] All tests passed
- [ ] Environment variables configured
- [ ] Monitoring setup complete
- [ ] Documentation reviewed
- [ ] Team trained on new feature
- [ ] Rollback plan tested

**Deployed by:** _________________  
**Date:** _________________  
**Version:** 1.0  
**Status:** ☐ Ready for Production

---

**Last Updated:** 2025  
**Document Version:** 1.0
