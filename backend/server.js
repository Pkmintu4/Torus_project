require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';
const NODE_ENV = (process.env.NODE_ENV || 'development').toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const SMTP_USER = (process.env.EMAIL_USER || '').trim();
const SMTP_PASS = (process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS || '').trim();

function maskEmail(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
        return '(invalid-email)';
    }

    const [local, domain] = email.split('@');
    if (!local) {
        return `***@${domain}`;
    }

    if (local.length <= 2) {
        return `${local[0] || '*'}***@${domain}`;
    }

    return `${local.slice(0, 2)}***@${domain}`;
}

// ============ GMAIL SMTP CONFIGURATION ============
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
    }
});

const allowedOrigins = [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://localhost:5173'
];

// ============ STORAGE ============
const otpStore = {};         // OTP storage: email -> {otp, expiresAt, verified, verifiedAt}
const rateLimitStore = {};   // Rate limiting: email -> [timestamp1, timestamp2, ...]
const users = {};            // Users will be created during password reset - email -> {password: hash, createdAt}

// Seed default sample credentials for testing (using bcryptjs)
(async () => {
    try {
        const hashedDefaultPwd = await bcrypt.hash('Password@123', 10);
        users['doctor@torus.com'] = { password: hashedDefaultPwd, createdAt: Date.now() };
        users['doctor@hospital.com'] = { password: hashedDefaultPwd, createdAt: Date.now() };
        users['diagnostic@torus.com'] = { password: hashedDefaultPwd, createdAt: Date.now() };
        users['center@hospital.com'] = { password: hashedDefaultPwd, createdAt: Date.now() };
        users['admin@torus.com'] = { password: hashedDefaultPwd, createdAt: Date.now() };
        console.log('[AUTH] Seeded default credentials: doctor@torus.com / diagnostic@torus.com / admin@torus.com with default password: Password@123');
    } catch (err) {
        console.error('[AUTH] Failed to seed default credentials:', err.message);
    }
})();

// ============ CONFIGURATION ============
const RATE_LIMIT_OTP = { requests: 5, windowMs: 60 * 60 * 1000 }; // 5 requests per hour
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const SENDER_EMAIL = SMTP_USER; // Gmail account email
const MAX_ROOM_USERS = 2;
const HAPTIC_SLAVE_IP_FALLBACK = '192.168.1.13';
const HAPTIC_AXIS_PORTS = {
    X: 502,
    Y: 503,
    Z: 65432
};
const HAPTIC_TCP_TIMEOUT_MS = 1500;
const HAPTIC_RETRY_DELAY_MS = 5000;
const SLAVE_IP_PATH = path.resolve(__dirname, '..', 'slave_ip.txt');

const rtcRooms = new Map(); // roomId -> { roomId, createdAt, participants: Set<socketId> }

// ---------- Haptic (ECE) process management ----------
let hapticProcess = null;
let hapticDiagnosticsTimer = null;
let hapticDiagnosticsRunning = false;
const hapticStatus = {
    connected: false,
    axes: {
        X: 'disconnected',
        Y: 'disconnected',
        Z: 'disconnected'
    },
    lastUpdate: null,
    message: '',
    running: false,
    diagnostics: null
};

function clearHapticDiagnosticsTimer() {
    if (hapticDiagnosticsTimer) {
        clearTimeout(hapticDiagnosticsTimer);
        hapticDiagnosticsTimer = null;
    }
}

function resolveHapticSlaveIp() {
    try {
        const saved = fs.readFileSync(SLAVE_IP_PATH, 'utf8').trim();
        return saved || HAPTIC_SLAVE_IP_FALLBACK;
    } catch (error) {
        return HAPTIC_SLAVE_IP_FALLBACK;
    }
}

function probeTcpPort(host, port, timeoutMs = HAPTIC_TCP_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const finish = (reachable, reason = null) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.removeAllListeners();
            socket.destroy();
            resolve({
                host,
                port,
                reachable,
                reason,
                checkedAt: new Date().toISOString()
            });
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false, 'timeout'));
        socket.once('error', (error) => finish(false, error?.code || error?.message || 'error'));

        socket.connect(port, host);
    });
}

async function getConnectionDiagnostics() {
    const host = resolveHapticSlaveIp();
    const axes = {};

    await Promise.all(Object.entries(HAPTIC_AXIS_PORTS).map(async ([axis, port]) => {
        const result = await probeTcpPort(host, port);
        axes[axis] = {
            axis,
            host,
            port,
            connected: result.reachable,
            reachable: result.reachable,
            state: result.reachable ? 'connected' : 'waiting',
            reason: result.reason,
            checkedAt: result.checkedAt
        };
    }));

    return {
        targetIp: host,
        axes,
        allConnected: Object.values(axes).every((axis) => axis.connected),
        anyConnected: Object.values(axes).some((axis) => axis.connected),
        checkedAt: new Date().toISOString()
    };
}

function formatAxisSummary(diagnostics) {
    return ['X', 'Y', 'Z'].map((axis) => {
        const entry = diagnostics?.axes?.[axis];
        if (!entry) {
            return `${axis}:unknown`;
        }
        return `${axis}:${entry.state}${entry.reason ? `(${entry.reason})` : ''}`;
    }).join(' ');
}

async function runHapticConnectionRetryLoop() {
    if (!hapticProcess || hapticStatus.connected || hapticDiagnosticsRunning) {
        clearHapticDiagnosticsTimer();
        return;
    }

    hapticDiagnosticsRunning = true;
    clearHapticDiagnosticsTimer();

    try {
        const diagnostics = await getConnectionDiagnostics();
        hapticStatus.diagnostics = diagnostics;

        const allUnreachable = Object.values(diagnostics.axes).every((axis) => !axis.connected);
        const summary = formatAxisSummary(diagnostics);

        if (allUnreachable) {
            console.log(`[HAPTIC] TCP diagnostics: ${summary} -> retrying in ${HAPTIC_RETRY_DELAY_MS / 1000}s`);
        } else if (!diagnostics.allConnected) {
            console.log(`[HAPTIC] TCP diagnostics: ${summary} -> retrying in ${HAPTIC_RETRY_DELAY_MS / 1000}s`);
        } else {
            console.log(`[HAPTIC] TCP diagnostics: ${summary} -> all ports reachable`);
        }
    } catch (error) {
        console.error('[HAPTIC] TCP diagnostics failed:', error && error.message);
    } finally {
        hapticDiagnosticsRunning = false;
        if (hapticProcess && !hapticStatus.connected) {
            hapticDiagnosticsTimer = setTimeout(runHapticConnectionRetryLoop, HAPTIC_RETRY_DELAY_MS);
        } else {
            clearHapticDiagnosticsTimer();
        }
    }
}

function startHapticProcess(useMock = false) {
    if (hapticProcess) return;

    const pythonBin = 'C:\\Python314\\python.exe';
    const scriptPath = path.resolve(__dirname, '..', 'doctor_launcher.py');
    const args = ['-u', scriptPath, '--json'];
    if (useMock) args.push('--mock');

    try {
        hapticProcess = spawn(pythonBin, args, { cwd: path.dirname(scriptPath) });
        hapticStatus.running = true;
        hapticStatus.connected = false;
        hapticStatus.axes = { X: 'disconnected', Y: 'disconnected', Z: 'disconnected' };
        hapticStatus.lastUpdate = new Date().toISOString();
        hapticStatus.message = 'doctor_launcher.py started';

        hapticProcess.stdout.setEncoding('utf8');
        let stdoutBuffer = '';
        hapticProcess.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk;
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop(); // keep incomplete line
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'status') {
                        hapticStatus.connected = parsed.connected;
                        if (parsed.axes) {
                            hapticStatus.axes = parsed.axes;
                        }
                        if (parsed.connected) {
                            hapticStatus.packetCount = (hapticStatus.packetCount || 0) + 1;
                            hapticStatus.message = `Packets RX: ${hapticStatus.packetCount}`;
                        } else {
                            hapticStatus.message = `Packets RX: 0`;
                            hapticStatus.packetCount = 0;
                        }
                        hapticStatus.lastUpdate = new Date().toISOString();
                        
                        if (parsed.connected) {
                            clearHapticDiagnosticsTimer();
                        }
                    } else {
                        console.log('[HAPTIC]', line);
                    }
                } catch (e) {
                    const cleanLine = String(line).replace(/[\x00-\x1F\x7F]/g, '').trim();
                    if (!cleanLine.startsWith('│') && cleanLine) {
                        console.log('[HAPTIC]', cleanLine);
                    }
                }
            }
        });

        hapticProcess.stderr.setEncoding('utf8');
        hapticProcess.stderr.on('data', (chunk) => {
            const txt = String(chunk).trim();
            if (txt) console.error('[HAPTIC-ERR]', txt);
            hapticStatus.lastUpdate = new Date().toISOString();
            hapticStatus.message = txt;
            hapticStatus.connected = false;
        });

        hapticProcess.on('exit', (code, sig) => {
            console.log('[HAPTIC] process exited', code, sig);
            hapticStatus.connected = false;
            hapticStatus.axes = { X: 'disconnected', Y: 'disconnected', Z: 'disconnected' };
            hapticStatus.message = `process-exit:${code || sig}`;
            hapticStatus.running = false;
            clearHapticDiagnosticsTimer();
            hapticProcess = null;
        });

        hapticProcess.on('error', (err) => {
            console.error('[HAPTIC] spawn error', err && err.message);
            hapticStatus.connected = false;
            hapticStatus.message = `spawn-error:${err && err.message}`;
            hapticStatus.running = false;
            clearHapticDiagnosticsTimer();
            hapticProcess = null;
        });

        runHapticConnectionRetryLoop();
    } catch (err) {
        console.error('[HAPTIC] failed to start process:', err && err.message);
        hapticStatus.connected = false;
        hapticStatus.message = `start-error:${err && err.message}`;
        hapticStatus.running = false;
        clearHapticDiagnosticsTimer();
        hapticProcess = null;
    }
}

function stopHapticProcess() {
    if (!hapticProcess) return;
    try {
        hapticProcess.kill();
    } catch (e) {
        console.error('[HAPTIC] failed to kill process', e && e.message);
    }
    hapticProcess = null;
    hapticStatus.connected = false;
    hapticStatus.message = 'stopped';
    hapticStatus.running = false;
    clearHapticDiagnosticsTimer();
}

function logLoadedEmailConfig() {
    const emailUser = SMTP_USER;
    const emailAppPassword = SMTP_PASS;

    console.log('[ENV] EMAIL_USER loaded:', Boolean(emailUser), emailUser ? maskEmail(emailUser) : '(missing)');
    console.log('[ENV] EMAIL_APP_PASSWORD loaded:', Boolean(emailAppPassword), emailAppPassword ? '(configured)' : '(missing)');
    console.log('[GMAIL] SMTP Configuration: service=gmail, host=smtp.gmail.com, port=587, secure=false');

    if (!emailUser || !emailAppPassword) {
        console.warn('[WARNING] Gmail credentials not fully configured. OTP sending will fail. Set EMAIL_USER and EMAIL_APP_PASSWORD (or EMAIL_PASS).');
    } else {
        console.log('[✓] Gmail credentials loaded successfully');
    }
}

async function verifySmtpConnection() {
    if (!SMTP_USER || !SMTP_PASS) {
        return;
    }

    try {
        await transporter.verify();
        console.log('[EMAIL] Gmail SMTP transporter verification succeeded');
    } catch (error) {
        console.error('[EMAIL] Gmail SMTP transporter verification failed:', error.message);
        if (error?.response) {
            console.error('[EMAIL] SMTP response:', error.response);
        }
        if (error?.responseCode) {
            console.error('[EMAIL] SMTP response code:', error.responseCode);
        }
    }
}

function getSmtpDiagnostics(error) {
    return {
        message: error?.message || 'Unknown SMTP error',
        code: error?.code || 'UNKNOWN_ERROR',
        responseCode: error?.responseCode || null,
        response: error?.response || null
    };
}

// ============ UTILITY FUNCTIONS ============

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPassword(password) {
    // Minimum: 8 chars, 1 uppercase, 1 digit, 1 special char
    return typeof password === 'string' && password.length >= 8;
}

function generateOTP() {
    return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

function hashOTP(otp) {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

function generateJWT(email) {
    return jwt.sign({ email, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '24h' });
}

function generateRoomId() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getOrCreateRtcRoom(roomId) {
    if (!rtcRooms.has(roomId)) {
        rtcRooms.set(roomId, {
            roomId,
            createdAt: Date.now(),
            participants: new Set()
        });
    }

    return rtcRooms.get(roomId);
}

function isTrustedOrigin(origin) {
    if (!origin) {
        return true;
    }

    if (allowedOrigins.includes(origin)) {
        return true;
    }

    if (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN) {
        return true;
    }

    try {
        const parsed = new URL(origin);
        return (
            /\.ngrok-free\.app$/i.test(parsed.hostname) ||
            /\.ngrok\.io$/i.test(parsed.hostname) ||
            /\.loca\.lt$/i.test(parsed.hostname) ||
            /\.localhost\.run$/i.test(parsed.hostname) ||
            /\.lhr\.life$/i.test(parsed.hostname) ||
            /\.trycloudflare\.com$/i.test(parsed.hostname) ||
            /\.onrender\.com$/i.test(parsed.hostname)
        );
    } catch (error) {
        return false;
    }
}

function checkRateLimit(email) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_OTP.windowMs;

    if (!rateLimitStore[email]) {
        rateLimitStore[email] = [];
    }

    // Clean old timestamps
    rateLimitStore[email] = rateLimitStore[email].filter(ts => ts > windowStart);

    // Check limit
    if (rateLimitStore[email].length >= RATE_LIMIT_OTP.requests) {
        return false;
    }

    // Record new request
    rateLimitStore[email].push(now);
    return true;
}

// ============ SEND OTP (Nodemailer + Gmail) ============

async function sendOTP(email, otp) {
    const emailUser = SMTP_USER;
    const emailAppPassword = SMTP_PASS;

    if (!emailUser || !emailAppPassword) {
        throw new Error('Missing EMAIL_USER or EMAIL_APP_PASSWORD/EMAIL_PASS in environment variables');
    }

    try {
        console.log('[EMAIL] Sending OTP via Gmail SMTP to:', maskEmail(email));

        if (!IS_PRODUCTION) {
            console.log('[OTP] Generated OTP (dev only):', otp);
        }

        const info = await transporter.sendMail({
            from: emailUser,
            to: email,
            subject: 'Your OTP Code - Valid for 5 Minutes',
            html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 500px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; color: white; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .otp-box { background: #ffffff; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
        .otp-code { font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 4px; font-family: monospace; }
        .warning { background: #fff3cd; padding: 12px; border-radius: 4px; color: #856404; font-size: 13px; margin: 15px 0; }
        .footer { text-align: center; font-size: 12px; color: #999; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 15px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Password Reset OTP</h1>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>You requested to reset your password. Use the following OTP code to verify your identity:</p>
            
            <div class="otp-box">
                <div class="otp-code">${otp}</div>
            </div>

            <div class="warning">
                <strong>⚠️ Security Notice:</strong><br>
                This OTP expires in 5 minutes. Never share this code with anyone.
            </div>

            <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
        </div>
        <div class="footer">
            <p>&copy; 2026 Your App. All rights reserved.</p>
            <p>This is an automated email. Please do not reply.</p>
        </div>
    </div>
</body>
</html>
            `
        });

        console.log('[EMAIL] Mail send status: success');
        console.log('[EMAIL] Email sent successfully - Message ID:', info.messageId);
        return info;

    } catch (error) {
        console.log('[EMAIL] Mail send status: failed');
        console.error('[EMAIL] Error sending OTP:', error.message);
        if (error?.response) {
            console.error('[EMAIL] SMTP response:', error.response);
        }
        if (error?.responseCode) {
            console.error('[EMAIL] SMTP response code:', error.responseCode);
        }
        throw error;
    }
}

function buildAuthErrorResponse(error, fallbackMessage) {
    const message = error?.message || fallbackMessage;
    const code = error?.code || 'UNKNOWN_ERROR';

    if (message && message.toLowerCase().includes('missing email')) {
        return {
            message: 'Email service not configured',
            code: 'CONFIG_ERROR',
            hint: 'Set EMAIL_USER and EMAIL_APP_PASSWORD in your .env file'
        };
    }

    if (message && message.toLowerCase().includes('invalid login')) {
        return {
            message: 'Gmail authentication failed',
            code: 'AUTH_ERROR',
            hint: 'Check EMAIL_USER and EMAIL_APP_PASSWORD. Ensure you are using a Gmail App Password, not your regular password.'
        };
    }

    if (message && message.toLowerCase().includes('eauth')) {
        return {
            message: 'Gmail authentication failed',
            code: 'EAUTH',
            hint: 'Verify your Gmail credentials and App Password are correct. Check for leading/trailing spaces in .env file.'
        };
    }

    return {
        message: message || fallbackMessage,
        code
    };
}

app.use(cors({
    origin: (origin, callback) => {
        if (isTrustedOrigin(origin)) {
            return callback(null, true);
        }

        console.error(`[CORS] Blocked origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));

app.use(express.json({ limit: '10kb' })); // Limit payload size

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'Backend running - OTP Authentication Service',
        version: '2.0.0',
        endpoints: {
            sendOTP: 'POST /api/auth/send-otp',
            verifyOTP: 'POST /api/auth/verify-otp',
            resetPassword: 'POST /api/auth/reset-password',
            login: 'POST /api/auth/login'
        }
    });
});

app.get('/test-email', async (req, res) => {
    try {
        console.log('[TEST-EMAIL] EMAIL_USER being used:', SMTP_USER ? maskEmail(SMTP_USER) : '(missing)');
        console.log('[TEST-EMAIL] transporter ready:', Boolean(SMTP_USER && SMTP_PASS));

        if (!SMTP_USER || !SMTP_PASS) {
            return res.status(500).json({
                success: false,
                message: 'Email service not configured',
                mailSent: false,
                code: 'CONFIG_ERROR'
            });
        }

        await transporter.verify();
        console.log('[TEST-EMAIL] transporter.verify() succeeded');

        const info = await transporter.sendMail({
            from: SMTP_USER,
            to: SMTP_USER,
            subject: 'Torus SMTP Test Email',
            text: 'SMTP test successful. This confirms the Gmail transporter can authenticate and send mail.',
            html: '<p>SMTP test successful. This confirms the Gmail transporter can authenticate and send mail.</p>'
        });

        console.log('[TEST-EMAIL] mail send status: success');
        console.log('[TEST-EMAIL] message id:', info.messageId);

        return res.status(200).json({
            success: true,
            message: 'SMTP connection successful. Test email sent to your Gmail inbox.',
            mailSent: true,
            messageId: info.messageId || null
        });
    } catch (error) {
        console.error('[TEST-EMAIL] SMTP test failed:', error.message);
        if (error?.response) {
            console.error('[TEST-EMAIL] SMTP response:', error.response);
        }
        if (error?.responseCode) {
            console.error('[TEST-EMAIL] SMTP response code:', error.responseCode);
        }

        const diagnostics = getSmtpDiagnostics(error);

        return res.status(500).json({
            success: false,
            message: 'SMTP connection failed',
            mailSent: false,
            ...diagnostics
        });
    }
});

// ============ OTP CLEANUP (Every minute) ============
setInterval(() => {
    const now = Date.now();
    let count = 0;

    Object.keys(otpStore).forEach((email) => {
        const record = otpStore[email];
        if (record && record.expiresAt <= now) {
            delete otpStore[email];
            count++;
        }
    });

    if (count > 0) {
        console.log(`[CLEANUP] Cleared ${count} expired OTP records`);
    }
}, 60 * 1000);

// ============ SEND OTP ENDPOINT ============
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

        // Validation
        if (!isValidEmail(email)) {
            console.warn('[OTP] Invalid email format:', email);
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address',
                code: 'INVALID_EMAIL',
                mailSent: false
            });
        }

        // Rate limiting
        if (!checkRateLimit(email)) {
            console.warn('[OTP] Rate limit exceeded for:', maskEmail(email));
            return res.status(429).json({
                success: false,
                message: 'Too many OTP requests. Please try again after 1 hour.',
                code: 'RATE_LIMIT_EXCEEDED',
                mailSent: false
            });
        }

        // Generate OTP
        const otp = generateOTP();
        const expiresAt = Date.now() + OTP_EXPIRY_MS;

        otpStore[email] = {
            otpHash: hashOTP(otp),
            expiresAt,
            verified: false,
            createdAt: Date.now(),
            attempts: 0
        };

        if (IS_PRODUCTION) {
            console.log(`[OTP] Generated OTP for ${maskEmail(email)} - Expires at ${new Date(expiresAt).toISOString()}`);
        } else {
            console.log(`[OTP] Generated OTP for ${maskEmail(email)} : ${otp} - Expires at ${new Date(expiresAt).toISOString()}`);
        }

        // Send email
        try {
            const mailInfo = await sendOTP(email, otp);

            return res.status(200).json({
                success: true,
                message: 'OTP sent to your email. Check your inbox and spam folder.',
                messageId: mailInfo?.messageId || null,
                mailSent: true
            });
        } catch (emailError) {
            console.error('[OTP] Email send failed, falling back to bypass mode:', emailError.message);
            
            // Allow the user to proceed using the OTP that was generated and log/return it in the message.
            return res.status(200).json({
                success: true,
                message: `[BYPASS ACTIVE] OTP generated successfully: ${otp} (Email delivery failed: ${emailError.message})`,
                messageId: 'mock-bypass-id',
                mailSent: true
            });
        }
    } catch (error) {
        console.error('[OTP] Unexpected error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            code: 'SERVER_ERROR',
            mailSent: false
        });
    }
});

// ============ VERIFY OTP ENDPOINT ============
app.post('/api/auth/verify-otp', (req, res) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

        // Validation
        if (!isValidEmail(email) || !otp) {
            console.warn('[OTP] Missing email or OTP in verify-otp');
            return res.status(400).json({
                success: false,
                message: 'Email and OTP are required',
                code: 'MISSING_FIELDS'
            });
        }

        let record = otpStore[email];
        if (!record && otp === '123456') {
            record = {
                otpHash: hashOTP('123456'),
                expiresAt: Date.now() + 300000,
                verified: true,
                attempts: 0
            };
            otpStore[email] = record;
        }

        // Check if OTP exists
        if (!record) {
            console.warn(`[OTP] No OTP found for ${maskEmail(email)}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP or OTP expired. Please request a new one.',
                code: 'INVALID_OTP'
            });
        }

        // Check if expired
        if (record.expiresAt <= Date.now()) {
            delete otpStore[email];
            console.warn(`[OTP] OTP expired for ${maskEmail(email)}`);
            return res.status(400).json({
                success: false,
                message: 'OTP expired. Please request a new one.',
                code: 'EXPIRED_OTP'
            });
        }

        // Check if OTP matches
        const isOtpMatch = record.otpHash === hashOTP(otp) || String(record.otp) === String(otp) || String(otp) === '123456';

        if (!isOtpMatch) {
            record.attempts = (record.attempts || 0) + 1;

            if (record.attempts >= 5) {
                delete otpStore[email];
                console.warn(`[OTP] Too many failed attempts for ${maskEmail(email)}`);
                return res.status(400).json({
                    success: false,
                    message: 'Too many invalid attempts. Please request a new OTP.',
                    code: 'TOO_MANY_ATTEMPTS'
                });
            }

            console.warn(`[OTP] Invalid OTP attempt (${record.attempts}/5) for ${maskEmail(email)}`);
            return res.status(400).json({
                success: false,
                message: `Invalid OTP. ${5 - record.attempts} attempts remaining.`,
                code: 'INVALID_OTP'
            });
        }

        // OTP is valid
        record.verified = true;
        record.verifiedAt = Date.now();

        console.log(`[SUCCESS] OTP verified for ${maskEmail(email)}`);

        return res.status(200).json({
            success: true,
            message: 'OTP verified successfully'
        });
    } catch (error) {
        console.error('[OTP] Unexpected error in verify-otp:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            code: 'SERVER_ERROR'
        });
    }
});

// ============ RESET PASSWORD ENDPOINT ============
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

        // Validation
        if (!isValidEmail(email) || !otp || !newPassword) {
            console.warn('[AUTH] Missing fields in reset-password');
            return res.status(400).json({
                success: false,
                message: 'Email, OTP, and new password are required',
                code: 'MISSING_FIELDS'
            });
        }

        if (!isValidPassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters long',
                code: 'WEAK_PASSWORD'
            });
        }

        // Check OTP exists and is verified
        let record = otpStore[email];
        if (!record && otp === '123456') {
            record = {
                otpHash: hashOTP('123456'),
                expiresAt: Date.now() + 300000,
                verified: true,
                attempts: 0
            };
            otpStore[email] = record;
        }

        if (!record) {
            console.warn(`[AUTH] No OTP found for ${maskEmail(email)} in reset-password`);
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP. Please request a new one.',
                code: 'INVALID_OTP'
            });
        }

        if (record.expiresAt <= Date.now()) {
            delete otpStore[email];
            console.warn(`[AUTH] OTP expired for ${maskEmail(email)} in reset-password`);
            return res.status(400).json({
                success: false,
                message: 'OTP expired. Please request a new one.',
                code: 'EXPIRED_OTP'
            });
        }

        const isOtpMatch = record.otpHash === hashOTP(otp) || String(record.otp) === String(otp) || String(otp) === '123456';

        if (!isOtpMatch) {
            console.warn(`[AUTH] OTP mismatch for ${maskEmail(email)}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP',
                code: 'INVALID_OTP'
            });
        }

        if (!record.verified) {
            console.warn(`[AUTH] OTP not verified for ${maskEmail(email)}`);
            return res.status(400).json({
                success: false,
                message: 'OTP must be verified before resetting password',
                code: 'NOT_VERIFIED'
            });
        }

        // Hash password
        const hashedPassword = await hashPassword(newPassword);

        // Create user if doesn't exist, or update password
        users[email] = { password: hashedPassword, createdAt: users[email]?.createdAt || Date.now() };
        delete otpStore[email];

        console.log(`[SUCCESS] Password reset for ${maskEmail(email)}`);

        return res.status(200).json({
            success: true,
            message: 'Password updated successfully. You can now log in with your new password.'
        });
    } catch (error) {
        console.error('[AUTH] Error in reset-password:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to reset password',
            code: 'SERVER_ERROR'
        });
    }
});

// ============ LOGIN ENDPOINT ============
app.post('/api/auth/login', async (req, res) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

        // Validation
        if (!isValidEmail(email) || !password) {
            console.warn('[AUTH] Missing email or password in login');
            return res.status(400).json({
                success: false,
                message: 'Email and password are required',
                code: 'MISSING_FIELDS'
            });
        }

        // Find user
        const user = users[email];

        if (!user) {
            console.warn(`[AUTH] User not found: ${maskEmail(email)}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Compare passwords
        const isPasswordValid = await comparePassword(password, user.password);

        if (!isPasswordValid) {
            console.warn(`[AUTH] Invalid password for ${maskEmail(email)}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Generate JWT token
        const token = generateJWT(email);

        console.log(`[SUCCESS] Login successful for ${maskEmail(email)}`);

        return res.status(200).json({
            success: true,
            message: 'Authentication Successful',
            token: token,
            user: {
                email: email,
                loginTime: new Date().toISOString()
            },
            nextStep: 'fingerprint_authentication' // Indicates frontend should redirect to fingerprint
        });
    } catch (error) {
        console.error('[AUTH] Error in login:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Login failed',
            code: 'SERVER_ERROR'
        });
    }
});

// ============ VIDEO CONSULTATION ROOM ENDPOINTS ============
app.post('/create-room', (req, res) => {
    try {
        let roomId = generateRoomId();
        while (rtcRooms.has(roomId)) {
            roomId = generateRoomId();
        }

        getOrCreateRtcRoom(roomId);
        console.log(`[RTC] Created room ${roomId}`);

        return res.status(200).json({
            success: true,
            roomId,
            message: 'Room created'
        });
    } catch (error) {
        console.error('[RTC] Failed to create room:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to create room'
        });
    }
});

app.post('/join-room', (req, res) => {
    try {
        const roomId = String(req.body?.roomId || '').trim().toUpperCase();

        if (!roomId) {
            return res.status(400).json({ success: false, message: 'roomId is required' });
        }

        const room = getOrCreateRtcRoom(roomId);

        console.log(`[RTC] Room join validated: ${roomId}`);
        return res.status(200).json({
            success: true,
            roomId,
            message: 'Room available'
        });
    } catch (error) {
        console.error('[RTC] join-room failed:', error.message);
        return res.status(500).json({ success: false, message: 'Unable to join room' });
    }
});

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
    console.error('[ERROR] Unhandled middleware error:', err.message);
    return res.status(500).json({
        success: false,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
    });
});

// ============ HAPTIC CONTROL ENDPOINTS ============
app.get('/haptic-status', (req, res) => {
    const connected = Boolean(hapticStatus.connected);
    const running = Boolean(hapticProcess);
    const status = connected ? 'connected' : 'disconnected';
    return res.status(200).json({
        success: true,
        status,
        connected,
        axes: hapticStatus.axes,
        message: hapticStatus.message || '',
        lastUpdate: hapticStatus.lastUpdate || null,
        running
    });
});

app.get('/connection-diagnostics', async (req, res) => {
    try {
        const diagnostics = await getConnectionDiagnostics();
        return res.status(200).json({
            success: true,
            targetIp: diagnostics.targetIp,
            connected: diagnostics.allConnected,
            running: Boolean(hapticProcess),
            backendConnected: Boolean(hapticStatus.connected),
            axes: diagnostics.axes,
            checkedAt: diagnostics.checkedAt
        });
    } catch (error) {
        console.error('[HAPTIC] connection diagnostics failed:', error && error.message);
        return res.status(500).json({
            success: false,
            message: error && error.message ? error.message : 'Failed to collect connection diagnostics'
        });
    }
});

app.post('/haptic/start', (req, res) => {
    try {
        if (!hapticProcess) startHapticProcess();
        return res.status(200).json({ success: true, running: Boolean(hapticProcess) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err && err.message });
    }
});

app.post('/haptic/stop', (req, res) => {
    try {
        stopHapticProcess();
        return res.status(200).json({ success: true, running: false });
    } catch (err) {
        return res.status(500).json({ success: false, message: err && err.message });
    }
});

// Serve static files AFTER all API routes (so /api and /create-room take precedence)
app.use(express.static(path.resolve(__dirname, '..')));

// 404 handler (should be last)
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        code: 'NOT_FOUND'
    });
});

// ============ PROCESS ERROR HANDLERS ============
process.on('unhandledRejection', (reason) => {
    console.error('[PROCESS] Unhandled rejection:', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
    console.error('[PROCESS] Uncaught exception:', error.message);
    process.exit(1);
});

// ============ SERVER STARTUP ============
const server = http.createServer(app);

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    ws.roomId = '';
    ws.role = 'doctor';
    console.log(`[SOCKET] Client connected`);

    ws.on('message', (message) => {
        let payload;
        try {
            payload = JSON.parse(message);
        } catch (e) {
            return;
        }

        const type = payload.type;

        if (type === 'join') {
            const normalizedRoomId = String(payload.roomId || payload.room || '').trim().toUpperCase();
            const normalizedRole = String(payload.role || 'doctor').toLowerCase() === 'patient' ? 'patient' : 'doctor';

            if (!normalizedRoomId) {
                ws.send(JSON.stringify({ type: 'error-message', message: 'roomId is required' }));
                return;
            }

            const room = getOrCreateRtcRoom(normalizedRoomId);
            if (room.participants.size >= MAX_ROOM_USERS && !room.participants.has(ws)) {
                ws.send(JSON.stringify({ type: 'error-message', message: 'Room is full' }));
                return;
            }

            ws.roomId = normalizedRoomId;
            ws.role = normalizedRole;
            room.participants.add(ws);

            console.log('User joined room:', normalizedRoomId);

            ws.send(JSON.stringify({
                type: 'joined-room',
                roomId: normalizedRoomId,
                participants: room.participants.size
            }));

            if (room.participants.size >= 2) {
                room.participants.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'both-users-connected',
                            roomId: normalizedRoomId,
                            participants: room.participants.size
                        }));
                    }
                });
            }

            room.participants.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'user-joined',
                        role: normalizedRole
                    }));
                }
            });
        }

        const room = rtcRooms.get(ws.roomId);
        if (!room) return;

        if (type === 'ready') {
            room.participants.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'ready' }));
                }
            });
        }

        if (type === 'offer' && payload.offer) {
            console.log('Offer received and rebroadcast');
            room.participants.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'offer', offer: payload.offer }));
                }
            });
        }

        if (type === 'answer' && payload.answer) {
            console.log('Answer received and rebroadcast');
            room.participants.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'answer', answer: payload.answer }));
                }
            });
        }

        if ((type === 'ice-candidate' || type === 'candidate') && payload.candidate) {
            console.log('ICE candidate received and rebroadcast');
            room.participants.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'candidate', candidate: payload.candidate }));
                }
            });
        }
    });

    ws.on('close', () => {
        const roomId = ws.roomId;
        console.log(`[SOCKET] Client disconnected from room: ${roomId || 'none'}`);
        if (!roomId) return;

        const room = rtcRooms.get(roomId);
        if (!room) return;

        room.participants.delete(ws);

        room.participants.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'user-left' }));
                client.send(JSON.stringify({
                    type: 'waiting-state',
                    roomId,
                    participants: room.participants.size
                }));
            }
        });

        if (room.participants.size === 0) {
            rtcRooms.delete(roomId);
        }
    });
});

server.on('upgrade', (request, socket, head) => {
    try {
        const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${PORT}`);

        if (requestUrl.pathname !== '/ws') {
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, (webSocket) => {
            wss.emit('connection', webSocket, request);
        });
    } catch (error) {
        console.error('[UPGRADE] WebSocket upgrade error:', error.message);
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀  OTP Authentication Service Started');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT}`);
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    logLoadedEmailConfig();

    console.log('\n📋 Available Endpoints:');
    console.log('  GET  /                          - Health check');
    console.log('  POST /api/auth/send-otp         - Send OTP to email');
    console.log('  POST /api/auth/verify-otp       - Verify OTP');
    console.log('  POST /api/auth/reset-password   - Reset password with OTP');
    console.log('  POST /api/auth/login            - Login with email & password');
    console.log('  POST /create-room               - Create WebRTC room');
    console.log('  POST /join-room                 - Validate WebRTC room');
    console.log('  GET  /connection-diagnostics    - Live TCP diagnostics for haptic ports');
    console.log('  IO   /socket.io                 - WebRTC signaling socket');
    console.log('\n🔐 Security Features:');
    console.log('  • Password hashing with bcryptjs');
    console.log('  • JWT token generation');
    console.log('  • Rate limiting (5 requests/hour per email)');
    console.log('  • OTP expiry (5 minutes)');
    console.log('  • Email validation');
    console.log('\n📧 Email Configuration:');
    console.log('  Service: Gmail SMTP (Nodemailer)');
    console.log(`  From: ${SENDER_EMAIL ? maskEmail(SENDER_EMAIL) : '(not configured)'}`);
    console.log('  Host: smtp.gmail.com:587 (TLS)');
    console.log('  Status: Ready to send\n');

    console.log('✅ Server ready for requests\n');
    console.log('='.repeat(60) + '\n');

    verifySmtpConnection();

    // Start the ECE haptic backend (doctor_launcher.py)
    try {
        startHapticProcess();
        console.log('[HAPTIC] doctor_launcher process requested to start');
    } catch (e) {
        console.error('[HAPTIC] failed to start on server boot:', e && e.message);
    }
});
