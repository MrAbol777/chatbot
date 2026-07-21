# Frontend Integration Examples

Complete examples for integrating the SMS service into your frontend application.

## React/JavaScript Examples

### 1. OTP Login Component

```javascript
import React, { useState } from 'react';

function OTPLogin() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone'); // 'phone' or 'verify'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  // Send OTP
  const handleSendOTP = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/sms/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });

      const data = await response.json();

      if (data.success) {
        setStep('verify');
        setCountdown(60); // Start 60 second countdown
        
        // Countdown timer
        const timer = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(data.error || 'Failed to send OTP');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP
  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/sms/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp })
      });

      const data = await response.json();

      if (data.success) {
        // OTP verified successfully
        console.log('Login successful!');
        // Redirect or update auth state
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="otp-login">
      {step === 'phone' ? (
        <form onSubmit={handleSendOTP}>
          <h2>Login with Phone</h2>
          <input
            type="tel"
            placeholder="09123456789"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            pattern="09[0-9]{9}"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      ) : (
        <form onSubmit={handleVerifyOTP}>
          <h2>Enter OTP</h2>
          <p>Code sent to {phone}</p>
          <input
            type="text"
            placeholder="123456"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            maxLength="6"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Verifying...' : 'Verify OTP'}
          </button>
          {countdown > 0 ? (
            <p>Resend in {countdown}s</p>
          ) : (
            <button type="button" onClick={() => setStep('phone')}>
              Resend OTP
            </button>
          )}
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </div>
  );
}

export default OTPLogin;
```

### 2. SMS Service Hook (React)

```javascript
// hooks/useSMS.js
import { useState } from 'react';

export function useSMS() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sendOTP = async (phone) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sms/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async (phone, otp) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sms/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Invalid OTP');
      }

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const sendSMS = async (phone, message) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to send SMS');
      }

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { sendOTP, verifyOTP, sendSMS, loading, error };
}
```

### 3. Using the Hook

```javascript
import React, { useState } from 'react';
import { useSMS } from './hooks/useSMS';

function LoginPage() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const { sendOTP, verifyOTP, loading, error } = useSMS();

  const handleSendOTP = async () => {
    try {
      await sendOTP(phone);
      setStep('verify');
    } catch (err) {
      console.error('Failed to send OTP:', err);
    }
  };

  const handleVerifyOTP = async () => {
    try {
      await verifyOTP(phone, otp);
      // Login successful
      console.log('Logged in!');
    } catch (err) {
      console.error('Failed to verify OTP:', err);
    }
  };

  return (
    <div>
      {step === 'phone' ? (
        <div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09123456789"
          />
          <button onClick={handleSendOTP} disabled={loading}>
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </div>
      ) : (
        <div>
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="Enter OTP"
          />
          <button onClick={handleVerifyOTP} disabled={loading}>
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

## Vanilla JavaScript Example

```javascript
// smsClient.js
class SMSClient {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  async sendOTP(phone) {
    const response = await fetch(`${this.baseURL}/api/sms/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to send OTP');
    }

    return data;
  }

  async verifyOTP(phone, otp) {
    const response = await fetch(`${this.baseURL}/api/sms/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Invalid OTP');
    }

    return data;
  }

  async sendSMS(phone, message) {
    const response = await fetch(`${this.baseURL}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message })
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return data;
  }
}

// Usage
const smsClient = new SMSClient();

// Send OTP
smsClient.sendOTP('09123456789')
  .then(data => console.log('OTP sent:', data))
  .catch(err => console.error('Error:', err));

// Verify OTP
smsClient.verifyOTP('09123456789', '123456')
  .then(data => console.log('Verified:', data))
  .catch(err => console.error('Error:', err));
```

## Vue.js Example

```vue
<template>
  <div class="otp-login">
    <div v-if="step === 'phone'">
      <h2>Login with Phone</h2>
      <input
        v-model="phone"
        type="tel"
        placeholder="09123456789"
        pattern="09[0-9]{9}"
      />
      <button @click="sendOTP" :disabled="loading">
        {{ loading ? 'Sending...' : 'Send OTP' }}
      </button>
    </div>

    <div v-else>
      <h2>Enter OTP</h2>
      <p>Code sent to {{ phone }}</p>
      <input
        v-model="otp"
        type="text"
        placeholder="123456"
        maxlength="6"
      />
      <button @click="verifyOTP" :disabled="loading">
        {{ loading ? 'Verifying...' : 'Verify OTP' }}
      </button>
      <button v-if="countdown === 0" @click="step = 'phone'">
        Resend OTP
      </button>
      <p v-else>Resend in {{ countdown }}s</p>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script>
export default {
  data() {
    return {
      phone: '',
      otp: '',
      step: 'phone',
      loading: false,
      error: '',
      countdown: 0
    };
  },
  methods: {
    async sendOTP() {
      this.error = '';
      this.loading = true;

      try {
        const response = await fetch('/api/sms/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: this.phone })
        });

        const data = await response.json();

        if (data.success) {
          this.step = 'verify';
          this.startCountdown();
        } else {
          this.error = data.error || 'Failed to send OTP';
        }
      } catch (err) {
        this.error = 'Network error. Please try again.';
      } finally {
        this.loading = false;
      }
    },

    async verifyOTP() {
      this.error = '';
      this.loading = true;

      try {
        const response = await fetch('/api/sms/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: this.phone, otp: this.otp })
        });

        const data = await response.json();

        if (data.success) {
          console.log('Login successful!');
          // Handle successful login
        } else {
          this.error = data.error || 'Invalid OTP';
        }
      } catch (err) {
        this.error = 'Network error. Please try again.';
      } finally {
        this.loading = false;
      }
    },

    startCountdown() {
      this.countdown = 60;
      const timer = setInterval(() => {
        this.countdown--;
        if (this.countdown <= 0) {
          clearInterval(timer);
        }
      }, 1000);
    }
  }
};
</script>
```

## Error Handling Best Practices

```javascript
async function sendOTPWithErrorHandling(phone) {
  try {
    const response = await fetch('/api/sms/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });

    const data = await response.json();

    // Handle different status codes
    switch (response.status) {
      case 200:
        return { success: true, data };
      
      case 400:
        return { success: false, error: 'Invalid phone number format' };
      
      case 429:
        return { 
          success: false, 
          error: `Please wait ${data.retryAfter} seconds before trying again` 
        };
      
      case 500:
        return { success: false, error: 'Server error. Please try again later.' };
      
      default:
        return { success: false, error: 'Unexpected error occurred' };
    }
  } catch (err) {
    // Network error
    return { 
      success: false, 
      error: 'Network error. Please check your connection.' 
    };
  }
}
```

## Phone Number Validation

```javascript
function validateIranianPhone(phone) {
  // Remove spaces and dashes
  const cleaned = phone.replace(/[-\s]/g, '');
  
  // Check format: 09XXXXXXXXX
  const regex = /^09[0-9]{9}$/;
  
  return regex.test(cleaned);
}

// Usage
const phone = '0912 345 6789';
if (validateIranianPhone(phone)) {
  // Send OTP
} else {
  alert('Invalid phone number format');
}
```

## Complete Login Flow Example

```javascript
class OTPAuthService {
  constructor() {
    this.phone = null;
    this.isAuthenticated = false;
  }

  async login(phone) {
    // Step 1: Send OTP
    const sendResult = await this.sendOTP(phone);
    if (!sendResult.success) {
      throw new Error(sendResult.error);
    }

    this.phone = phone;
    return sendResult;
  }

  async verify(otp) {
    // Step 2: Verify OTP
    const verifyResult = await this.verifyOTP(this.phone, otp);
    if (!verifyResult.success) {
      throw new Error(verifyResult.error);
    }

    this.isAuthenticated = true;
    
    // Step 3: Create session (your implementation)
    await this.createSession(this.phone);
    
    return verifyResult;
  }

  async sendOTP(phone) {
    const response = await fetch('/api/sms/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });

    return await response.json();
  }

  async verifyOTP(phone, otp) {
    const response = await fetch('/api/sms/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });

    return await response.json();
  }

  async createSession(phone) {
    // Your session creation logic
    localStorage.setItem('userPhone', phone);
    localStorage.setItem('isAuthenticated', 'true');
  }

  logout() {
    this.isAuthenticated = false;
    this.phone = null;
    localStorage.removeItem('userPhone');
    localStorage.removeItem('isAuthenticated');
  }
}

// Usage
const authService = new OTPAuthService();

// Login flow
async function handleLogin(phone) {
  try {
    await authService.login(phone);
    // Show OTP input
  } catch (err) {
    console.error('Login failed:', err);
  }
}

async function handleVerify(otp) {
  try {
    await authService.verify(otp);
    // Redirect to dashboard
  } catch (err) {
    console.error('Verification failed:', err);
  }
}
```

---

**Integration Guide Version:** 1.0  
**Last Updated:** 2025  
**Compatible With:** React, Vue, Angular, Vanilla JS
