# 🚀 Deployment Guide (Torus v1 — No Biometric/OTP)

## 📋 Quick Overview
- **Scope:** Core patient/doctor portal + haptic diagnostics (skip biometric hardware & email OTP)
- **Stack:** Node.js services (ports 5000, 5002) + SQLite → Postgres + Static frontend
- **Free hosting:** Render (Node), Netlify (frontend), Neon/Supabase (database)

---

## 🔧 Pre-Deployment Checklist

### 1. Environment Variables
Create `.env` files for each backend service with real values (never commit secrets):

**`backend/.env`** (port 5000 — auth & haptic)
```env
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/torus
PORT=5000
JWT_SECRET=your_strong_random_secret_here
EMAIL_USER=your_email@example.com
EMAIL_APP_PASSWORD=your_app_password
PYTHON=python3
DATABASE_URL=postgresql://user:pass@host:5432/torus_db
```

**Root `.env`** (port 5002 — main server)
```env
PORT=5002
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/torus_db
API_BASE_URL=https://yourdomain.com
AUTH_API_BASE=https://auth-backend.yourdomain.com
```

### 2. Update Runtime Config
Ensure `config.js` (or `frontend/vite.config.js`) is configured for production URLs:

**`config.js` (if serving from same host)**
```javascript
window.__API_BASE__ = window.location.origin; // Derives from deployment URL
window.__AUTH_API_BASE__ = window.location.origin + '/auth';
```

### 3. Database Migration (SQLite → Postgres)
Run locally or on deployment host:
```bash
# Export SQLite data
sqlite3 torus_database.sqlite .dump > sqlite_export.sql

# Create new database on Neon/Supabase
# Import schema and data (adapt SQL dialect if needed)
psql postgresql://user:pass@host:5432/torus_db -f sqlite_export.sql
```

---

## 🌐 Deployment Option A: Render (Recommended for Free Tier)

### Step 1: Prepare Git & Render Account
1. Push code to GitHub (already done: `https://github.com/Pkmintu4/Torus_project`)
2. Sign up at [render.com](https://render.com) (free tier includes WebSocket support)
3. Connect your GitHub account to Render

### Step 2: Deploy Backend Services

#### Deploy `backend/server.js` (Port 5000)
1. Go to Render Dashboard → "New +" → "Web Service"
2. Select your GitHub repo (`Pkmintu4/Torus_project`)
3. Configure:
   - **Name:** `torus-auth-backend`
   - **Environment:** Node.js
   - **Build command:** `cd backend && npm install`
   - **Start command:** `cd backend && node server.js`
   - **Plan:** Free tier
4. Add environment variables from `.env`:
   - `MONGO_URI`
   - `JWT_SECRET`
   - `EMAIL_USER` / `EMAIL_APP_PASSWORD`
   - `DATABASE_URL` (Postgres connection)
   - `PORT=5000`
5. Deploy

#### Deploy Root `server.js` (Port 5002)
1. Create another Web Service
2. Configure:
   - **Name:** `torus-main-server`
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
   - **Start command:** `node server.js`
3. Add environment variables:
   - `DATABASE_URL`
   - `PORT=5002`
   - `NODE_ENV=production`
4. Deploy

### Step 3: Deploy Frontend

#### Option A1: Static Deploy (Netlify)
1. Build React frontend:
   ```bash
   cd frontend
   npm install
   npm run build
   ```
2. Deploy to [Netlify](https://netlify.com):
   - Drag & drop the `frontend/dist` folder
   - Set environment: `VITE_API_BASE=https://torus-main-server.onrender.com`
3. Update HTML pages to point to Render backends:
   - Edit `config.js` in root to set `window.__API_BASE__` to your Render domain

#### Option A2: Serve From Node on Render
Update root `server.js` to serve static files:
```javascript
const express = require('express');
const path = require('path');
const app = express();

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend/dist')));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

// API routes (keep existing)
app.use('/api', apiRoutes);
```

### Step 4: Database Setup

1. Create Postgres database on [Neon](https://neon.tech) or [Supabase](https://supabase.com):
   - Sign up (free tier)
   - Create new project
   - Copy `DATABASE_URL` connection string
2. Add `DATABASE_URL` to both Render services
3. Run migrations on deployment (or use seed script)

### Step 5: Configure Custom Domain (Optional)
1. In Render service settings → "Custom Domain"
2. Add your domain (e.g., `api.yourdomain.com`)
3. Follow DNS instructions

---

## 🌐 Deployment Option B: Railway (Alternative)

1. Sign up at [railway.app](https://railway.app)
2. Connect GitHub
3. Create services for:
   - `backend/server.js`
   - Root `server.js`
4. Link Postgres plugin (free tier)
5. Set environment variables
6. Deploy

---

## 🌐 Deployment Option C: Heroku (Legacy but Simple)

**Note:** Heroku removed free tier (Nov 2022). Recommend Render/Railway instead.

---

## 🧪 Post-Deployment Testing

### 1. Test Backend APIs
```bash
# Test auth backend
curl -X POST https://torus-auth-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}'

# Test main server
curl https://torus-main-server.onrender.com/api/dashboard
```

### 2. Test Frontend
1. Navigate to your deployed frontend URL
2. Open browser DevTools → Network tab
3. Verify API calls go to Render backends (not localhost)
4. Test login, dashboard, haptic diagnostics flow

### 3. Check Logs
- Render: Service → "Logs" tab
- Railway: Deployments → Logs
- Supabase/Neon: Dashboard → Query metrics

---

## 🔐 Security Checklist

- [ ] Never commit `.env` files (use `.gitignore`)
- [ ] Use strong random `JWT_SECRET` (>32 chars)
- [ ] Rotate exposed credentials (MongoDB, email app passwords)
- [ ] Enable HTTPS on all services (automatic on Render/Railway)
- [ ] Set CORS headers if frontend is on different domain
- [ ] Review and redact any hardcoded API keys in code
- [ ] Use environment variables for all secrets

---

## 📊 Estimated Free Tier Limits

| Service | Free Tier | Cost if Exceeded |
|---------|-----------|-----------------|
| Render (Node) | 750 hrs/month | $0.005/hour |
| Netlify (Static) | Unlimited | $0 (for static) |
| Supabase (Postgres) | 500 MB storage, 2 GB transfer | $25/month starter |
| Neon (Postgres) | 3 branches, 10 GB storage | $0.38/GB overage |

---

## 🚨 Troubleshooting

### "Cannot find module" after deployment
- Ensure `npm install` is run in build command
- Check build logs for missing dependencies

### API calls fail with CORS errors
Add CORS middleware to backend:
```javascript
const cors = require('cors');
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
```

### Database connection timeout
- Verify `DATABASE_URL` is correct
- Check firewall rules (Render/Railway IPs should be whitelisted)
- Test locally: `psql $DATABASE_URL`

### Frontend shows 404 for API calls
- Verify `config.js` is setting correct API base
- Check that backend services are running (`curl` test)
- Review browser Network tab for actual request URLs

---

## 📚 Next Steps

1. **Choose hosting:** Render (recommended) or Railway
2. **Create database:** Neon or Supabase
3. **Set up `.env` files:** Copy from `.env.example`
4. **Deploy backends:** Follow Render/Railway guides
5. **Deploy frontend:** Netlify or serve from main Node service
6. **Test endpoints:** Verify all API calls work
7. **Set custom domain:** (optional) Update DNS

---

## 💡 Tips

- Start with **all services on free tier** (limited but sufficient for MVP/demo)
- Use **same database for both Node services** (easier data sync)
- Consider **serverless functions** (AWS Lambda, Vercel) for OTP/email later
- Add **monitoring** (Sentry, DataDog) if scaling beyond free tier

---

**Questions?** Check service docs:
- [Render Docs](https://render.com/docs)
- [Railway Docs](https://docs.railway.app)
- [Neon Docs](https://neon.tech/docs)
- [Supabase Docs](https://supabase.com/docs)
