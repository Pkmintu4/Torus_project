const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const Doctor = require('../models/Doctor');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

const createTransporter = async () => {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS
        }
    });
};

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ msg: 'Database connection error' });
        }

        const doctor = await Doctor.findOne({ email });
        
        if (!doctor) {
            console.log(`[LOGIN] User fetched from DB: Not Found for ${email}`);
            console.log(`[LOGIN] Login failure`);
            return res.status(404).json({ msg: 'User not found' });
        }
        
        console.log(`[LOGIN] User fetched from DB: Found for ${email}`);

        const isMatch = await bcrypt.compare(password, doctor.password);

        if (!isMatch) {
            console.log(`[LOGIN] Login failure`);
            return res.status(400).json({ msg: 'Incorrect password' });
        }

        console.log(`[LOGIN] Login success`);

        const payload = {
            doctor: {
                id: doctor.id
            }
        };

        jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
            if (err) throw err;
            res.json({
                token,
                doctor: {
                    id: doctor.id,
                    name: doctor.name,
                    email: doctor.email
                }
            });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Internal server error' });
    }
});

router.post('/send-otp', async (req, res) => {
    const { email } = req.body;
    console.log(`[API] POST /api/auth/send-otp hit for email: ${email || 'missing-email'}`);

    if (!email) {
        console.error('[API] send-otp rejected: email is required');
        return res.status(400).json({
            success: false,
            msg: 'Email is required'
        });
    }

    try {
        if (mongoose.connection.readyState !== 1) {
            console.error('[API] send-otp failed: database not connected');
            return res.status(500).json({
                success: false,
                msg: 'Database connection error'
            });
        }

        const doctor = await Doctor.findOne({ email });
        if (!doctor) {
            console.error(`[API] send-otp failed: user not found for ${email}`);
            return res.status(404).json({
                success: false,
                msg: 'User not found'
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        doctor.otp = otp;
        doctor.otpExpiry = Date.now() + 5 * 60 * 1000;
        await doctor.save();

        console.log(`[OTP] Generated and stored for ${email}`);

        if (!process.env.EMAIL_USER || !(process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS)) {
            console.error('[EMAIL] EMAIL_USER or EMAIL_APP_PASSWORD/EMAIL_PASS is missing in environment');
            return res.status(500).json({
                success: false,
                msg: 'Email setup missing'
            });
        }

        const transporter = await createTransporter();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: doctor.email,
            subject: 'Your OTP for Password Reset',
            text: `Your OTP is: ${otp}. It is valid for 5 minutes.`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] OTP sent successfully. Message ID: ${info.messageId}`);

        res.status(200).json({
            success: true,
            msg: 'OTP sent to your email',
            mailSent: true
        });
    } catch (err) {
        console.error('[API] send-otp failed with error:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Email sending failed',
            mailSent: false,
            error: err.code || 'UNKNOWN_ERROR'
        });
    }
});

router.post('/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ msg: 'Database connection error' });
        }

        const doctor = await Doctor.findOne({
            email,
            otp,
            otpExpiry: { $gt: Date.now() }
        });

        if (!doctor) {
            return res.status(400).json({ msg: 'Invalid OTP' });
        }

        res.json({ msg: 'Valid OTP' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/reset-password', async (req, res) => {
    const { email, otp, password } = req.body;
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ msg: 'Database connection error' });
        }

        const doctor = await Doctor.findOne({
            email,
            otp,
            otpExpiry: { $gt: Date.now() }
        });

        if (!doctor) {
            return res.status(400).json({ msg: 'Invalid OTP' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        doctor.password = hashedPassword;
        doctor.otp = undefined;
        doctor.otpExpiry = undefined;
        await doctor.save();

        console.log(`Password updated`);

        res.json({ msg: 'Password successfully updated' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
